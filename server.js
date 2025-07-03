const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const mercadopago = require('mercadopago');

const app = express();
app.use(express.json());
app.use(cors());

mercadopago.configure({
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

mongoose.set('strictQuery', false);
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log('Conectado ao MongoDB')).catch(err => console.error('Erro ao conectar ao MongoDB:', err));

const compradorSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    status: { type: String, default: 'disponível' },
    userId: String,
    timestamp: Date,
    buyerName: String,
    buyerPhone: String,
});
const Comprador = mongoose.model('Comprador', compradorSchema, 'compradores');

async function initializeNumbers() {
    try {
        const count = await Comprador.countDocuments();
        if (count === 0) {
            const numbers = Array.from({ length: 100 }, (_, i) => ({
                number: String(i + 1).padStart(3, '0'),
                status: 'disponível',
            }));
            await Comprador.insertMany(numbers);
            console.log('Números de 001 a 100 inicializados na coleção compradores.');
        }
    } catch (error) {
        console.error('Erro ao inicializar números:', error);
    }
}
initializeNumbers();

app.get('/available_numbers', async (req, res) => {
    try {
        const numbers = await Comprador.find({ status: 'disponível' }).select('number');
        res.json(numbers.map(n => n.number));
    } catch (error) {
        console.error('Erro ao buscar números disponíveis:', error);
        res.status(500).json([]);
    }
});

app.post('/reserve_numbers', async (req, res) => {
    const { numbers, userId } = req.body;
    try {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const availableNumbers = await Comprador.find({ number: { $in: numbers }, status: 'disponível' }).session(session);
            if (availableNumbers.length !== numbers.length) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ success: false, message: 'Alguns números não estão disponíveis.' });
            }
            await Comprador.updateMany(
                { number: { $in: numbers } },
                { $set: { status: 'reservado', userId, timestamp: new Date() } },
                { session }
            );
            await session.commitTransaction();
            session.endSession();
            res.json({ success: true });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    } catch (error) {
        console.error('Erro ao reservar números:', error);
        res.status(500).json({ success: false, message: 'Erro ao reservar números.' });
    }
});

app.post('/check_reservation', async (req, res) => {
    const { numbers, userId } = req.body;
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const validNumbers = await Comprador.find({
            number: { $in: numbers },
            status: 'reservado',
            userId,
            timestamp: { $gt: fiveMinutesAgo },
        });
        res.json({ valid: validNumbers.length === numbers.length });
    } catch (error) {
        console.error('Erro ao verificar reserva:', error);
        res.status(500).json({ valid: false });
    }
});

app.post('/create_preference', async (req, res) => {
    const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
    try {
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const validNumbers = await Comprador.find({
                number: { $in: numbers },
                status: 'reservado',
                userId,
                timestamp: { $gt: fiveMinutesAgo },
            }).session(session);
            if (validNumbers.length !== numbers.length) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).json({ error: 'Números não estão mais reservados para você.' });
            }

            const preference = {
                items: [
                    {
                        title: 'Sorteio Sub-zero Beer',
                        unit_price: quantity * 10,
                        quantity: 1,
                    },
                ],
                back_urls: {
                    success: 'https://ederamorimth.github.io/subzerobeer/success.html',
                    failure: 'https://ederamorimth.github.io/subzerobeer/failure.html',
                    pending: 'https://ederamorimth.github.io/subzerobeer/pending.html',
                },
                auto_return: 'approved',
            };
            const response = await mercadopago.preferences.create(preference);
            const paymentLink = response.body.init_point;

            await Comprador.updateMany(
                { number: { $in: numbers } },
                { $set: { status: 'vendido', buyerName, buyerPhone } },
                { session }
            );
            await session.commitTransaction();
            session.endSession();
            res.json({ init_point: paymentLink });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    } catch (error) {
        console.error('Erro ao processar pagamento:', error);
        res.status(500).json({ error: 'Erro ao processar pagamento.' });
    }
});

app.post('/webhook', async (req, res) => {
    const payment = req.body;
    console.log('Webhook recebido:', payment);
    if (payment.action === 'payment.updated' && payment.data.status === 'approved') {
        const paymentId = payment.data.id;
        console.log(`Pagamento ${paymentId} aprovado.`);
        // Aqui você pode adicionar lógica para atualizar o banco, se necessário
    }
    res.sendStatus(200);
});

app.get('/progress', async (req, res) => {
    try {
        const total = await Comprador.countDocuments();
        const sold = await Comprador.countDocuments({ status: 'vendido' });
        const progress = (sold / total) * 100;
        res.json({ progress });
    } catch (error) {
        console.error('Erro ao calcular progresso:', error);
        res.status(500).json({ progress: 0 });
    }
});

app.listen(3000, () => console.log('Servidor rodando na porta 3000'));

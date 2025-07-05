const express = require('express');
const mongoose = require('mongoose');
const MercadoPago = require('mercadopago');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configuração do Mercado Pago
MercadoPago.configure({
    access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN || 'SEU_ACCESS_TOKEN_AQUI'
});

// Conexão com o MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/subzerobeer', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('[' + new Date().toISOString() + '] Conectado ao MongoDB');
}).catch(err => {
    console.error('[' + new Date().toISOString() + '] Erro ao conectar ao MongoDB:', err.message);
});

// Schema para números
const NumberSchema = new mongoose.Schema({
    number: { type: String, required: true },
    status: { type: String, enum: ['disponível', 'reservado', 'vendido'], default: 'disponível' },
    userId: { type: String, default: null },
    reservationTime: { type: Date, default: null },
    buyerName: { type: String, default: null },
    buyerPhone: { type: String, default: null }
});

const Number = mongoose.model('Number', NumberSchema);

// Schema para compras
const PurchaseSchema = new mongoose.Schema({
    numbers: [String],
    userId: String,
    buyerName: String,
    buyerPhone: String,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const Purchase = mongoose.model('Purchase', PurchaseSchema);

// Schema para ganhadores
const WinnerSchema = new mongoose.Schema({
    buyerName: String,
    buyerPhone: String,
    winningNumber: String,
    numbers: [String],
    drawDate: Date,
    photoUrl: String
});

const Winner = mongoose.model('Winner', WinnerSchema);

// Inicializar números (1 a 150)
async function initializeNumbers() {
    const count = await Number.countDocuments();
    if (count === 0) {
        const numbers = Array.from({ length: 150 }, (_, i) => ({
            number: String(i + 1).padStart(3, '0'),
            status: 'disponível'
        }));
        await Number.insertMany(numbers);
        console.log('[' + new Date().toISOString() + '] Números inicializados');
    }
}

initializeNumbers();

// Rota de health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

// Rota para obter números disponíveis
app.get('/available_numbers', async (req, res) => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        await Number.updateMany(
            { status: 'reservado', reservationTime: { $lt: fiveMinutesAgo } },
            { $set: { status: 'disponível', userId: null, reservationTime: null, buyerName: null, buyerPhone: null } }
        );
        const numbers = await Number.find();
        res.json(numbers);
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao obter números:', error.message);
        res.status(500).json({ error: 'Erro ao obter números' });
    }
});

// Rota para reservar números
app.post('/reserve_numbers', async (req, res) => {
    const { numbers, userId } = req.body;
    try {
        const availableNumbers = await Number.find({ number: { $in: numbers }, status: 'disponível' });
        if (availableNumbers.length !== numbers.length) {
            return res.status(400).json({ success: false, message: 'Um ou mais números não estão disponíveis' });
        }
        await Number.updateMany(
            { number: { $in: numbers } },
            { $set: { status: 'reservado', userId, reservationTime: new Date() } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao reservar números:', error.message);
        res.status(500).json({ success: false, message: 'Erro ao reservar números' });
    }
});

// Rota para verificar reservas
app.post('/check_reservation', async (req, res) => {
    const { numbers, userId } = req.body;
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const reservedNumbers = await Number.find({
            number: { $in: numbers },
            userId,
            status: 'reservado',
            reservationTime: { $gte: fiveMinutesAgo }
        });
        res.json({ valid: reservedNumbers.length === numbers.length });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao verificar reservas:', error.message);
        res.status(500).json({ valid: false });
    }
});

// Rota para criar preferência de pagamento
app.post('/create_preference', async (req, res) => {
    const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
    try {
        const preference = {
            items: [{
                title: 'Sub-zero Beer Sorteio',
                unit_price: 10,
                quantity: quantity,
            }],
            back_urls: {
                success: 'https://ederamorimth.github.io/subzerobeer/index.html?status=approved',
                failure: 'https://ederamorimth.github.io/subzerobeer/index.html?status=rejected',
                pending: 'https://ederamorimth.github.io/subzerobeer/index.html?status=pending'
            },
            auto_return: 'approved',
            external_reference: JSON.stringify({ numbers, userId, buyerName, buyerPhone })
        };

        const response = await MercadoPago.preferences.create(preference);
        await Number.updateMany(
            { number: { $in: numbers } },
            { $set: { buyerName, buyerPhone } }
        );
        await Purchase.create({ numbers, userId, buyerName, buyerPhone, status: 'pending' });
        res.json({ init_point: response.body.init_point });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao criar preferência:', error.message);
        res.status(500).json({ error: 'Erro ao criar preferência de pagamento' });
    }
});

// Rota para obter compras
app.get('/purchases', async (req, res) => {
    try {
        const purchases = await Purchase.find();
        res.json(purchases);
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao obter compras:', error.message);
        res.status(500).json({ error: 'Erro ao obter compras' });
    }
});

// Rota para obter ganhadores
app.get('/winners', async (req, res) => {
    try {
        const winners = await Winner.find();
        res.json(winners);
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao obter ganhadores:', error.message);
        res.status(500).json({ error: 'Erro ao obter ganhadores' });
    }
});

// Rota para salvar ganhador
app.post('/save_winner', async (req, res) => {
    const { buyerName, buyerPhone, winningNumber, numbers, drawDate, photoUrl } = req.body;
    try {
        await Winner.create({ buyerName, buyerPhone, winningNumber, numbers, drawDate, photoUrl });
        await Number.updateMany(
            { number: { $in: numbers } },
            { $set: { status: 'vendido' } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao salvar ganhador:', error.message);
        res.status(500).json({ error: 'Erro ao salvar ganhador' });
    }
});

// Rota para webhook do Mercado Pago
app.post('/webhook', async (req, res) => {
    const { data } = req.body;
    try {
        if (data && data.id) {
            const payment = await MercadoPago.payment.get(data.id);
            const { external_reference, status } = payment.body;
            const { numbers, userId, buyerName, buyerPhone } = JSON.parse(external_reference);
            await Purchase.updateOne(
                { userId, numbers: { $all: numbers } },
                { $set: { status } }
            );
            if (status === 'approved') {
                await Number.updateMany(
                    { number: { $in: numbers } },
                    { $set: { status: 'vendido', buyerName, buyerPhone } }
                );
            } else if (status === 'rejected') {
                await Number.updateMany(
                    { number: { $in: numbers } },
                    { $set: { status: 'disponível', userId: null, reservationTime: null, buyerName: null, buyerPhone: null } }
                );
            }
            console.log('[' + new Date().toISOString() + '] Webhook processado: status=' + status + ', números=' + numbers);
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro no webhook:', error.message);
        res.status(500).send('Erro no webhook');
    }
});

// Iniciar servidor
app.listen(port, () => {
    console.log('[' + new Date().toISOString() + '] Servidor rodando na porta ' + port);
});

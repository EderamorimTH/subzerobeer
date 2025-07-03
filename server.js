const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({ origin: 'https://ederamorimth.github.io', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));

// Configurar strictQuery para suprimir aviso de depreciação
mongoose.set('strictQuery', false);

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log(`[${new Date().toISOString()}] Conectado ao MongoDB`))
  .catch(err => console.error(`[${new Date().toISOString()}] Erro ao conectar ao MongoDB:`, err));

const compradorSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    status: { type: String, default: 'disponível' },
    userId: String,
    timestamp: Date,
});

const purchaseSchema = new mongoose.Schema({
    buyerName: { type: String, required: true },
    buyerPhone: { type: String, required: true },
    numbers: { type: [String], required: true },
    purchaseDate: { type: Date, default: Date.now },
    paymentId: String,
    status: { type: String, default: 'pending' },
    date_approved: Date,
    preference_id: String,
});

const Comprador = mongoose.model('Comprador', compradorSchema, 'compradores');
const Purchase = mongoose.model('Purchase', purchaseSchema, 'purchases');

const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });

app.get('/available_numbers', async (req, res) => {
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        await Comprador.updateMany(
            { status: 'reservado', timestamp: { $lt: fiveMinutesAgo } },
            { $set: { status: 'disponível', userId: null, timestamp: null } }
        );
        const compradores = await Comprador.find({ status: 'disponível' }).select('number');
        console.log(`[${new Date().toISOString()}] Números disponíveis retornados: ${compradores.length}`);
        res.json(compradores.map(c => c.number));
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao buscar números disponíveis:`, error);
        res.status(500).json({ error: 'Erro ao buscar números disponíveis' });
    }
});

app.get('/progress', async (req, res) => {
    try {
        const total = await Comprador.countDocuments();
        const sold = await Comprador.countDocuments({ status: 'vendido' });
        const progress = total ? (sold / total) * 100 : 0;
        console.log(`[${new Date().toISOString()}] Progresso: ${progress}% (${sold}/${total})`);
        res.json({ progress });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao calcular progresso:`, error);
        res.status(500).json({ error: 'Erro ao calcular progresso' });
    }
});

app.post('/reserve_numbers', async (req, res) => {
    const { numbers, userId } = req.body;
    console.log(`[${new Date().toISOString()}] Recebendo solicitação para reservar números: ${numbers}, userId: ${userId}`);
    try {
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
            console.error(`[${new Date().toISOString()}] Dados incompletos na solicitação de reserva`);
            return res.status(400).json({ error: 'Dados incompletos' });
        }
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            const existingNumbers = await Comprador.find({ number: { $in: numbers }, status: 'disponível' }).session(session);
            if (existingNumbers.length !== numbers.length) {
                await session.abortTransaction();
                session.endSession();
                console.error(`[${new Date().toISOString()}] Alguns números não estão disponíveis`);
                return res.status(400).json({ error: 'Alguns números não estão disponíveis' });
            }
            const result = await Comprador.updateMany(
                { number: { $in: numbers }, status: 'disponível' },
                { $set: { status: 'reservado', userId, timestamp: new Date() } },
                { session }
            );
            await session.commitTransaction();
            session.endSession();
            console.log(`[${new Date().toISOString()}] Números ${numbers.join(', ')} reservados com sucesso para userId: ${userId}`);
            res.json({ message: 'Números reservados com sucesso', success: true });
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao reservar números:`, error);
        res.status(500).json({ error: 'Erro ao reservar números' });
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
            timestamp: { $gte: fiveMinutesAgo }
        });
        console.log(`[${new Date().toISOString()}] Verificação de reserva para números ${numbers.join(', ')}, userId: ${userId}, válida: ${validNumbers.length === numbers.length}`);
        res.json({ valid: validNumbers.length === numbers.length });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao verificar reserva:`, error);
        res.status(500).json({ error: 'Erro ao verificar reserva' });
    }
});

app.post('/create_preference', async (req, res) => {
    console.log(`[${new Date().toISOString()}] Recebendo solicitação para criar preferência:`, req.body);
    try {
        const { numbers, userId, buyerName, buyerPhone } = req.body;
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId || !buyerName || !buyerPhone) {
            console.error(`[${new Date().toISOString()}] Dados incompletos na solicitação de preferência`);
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        const validNumbers = await Comprador.find({ number: { $in: numbers }, status: 'reservado', userId });
        if (validNumbers.length !== numbers.length) {
            console.error(`[${new Date().toISOString()}] Números não estão reservados para o usuário: ${userId}`);
            return res.status(400).json({ error: 'Números não estão reservados para este usuário' });
        }

        const preference = {
            items: numbers.map(number => ({
                title: `Número ${number}`,
                quantity: 1,
                unit_price: 10,
            })),
            back_urls: {
                success: 'https://ederamorimth.github.io/subzerobeer/index.html',
                failure: 'https://ederamorimth.github.io/subzerobeer/index.html',
                pending: 'https://ederamorimth.github.io/subzerobeer/index.html',
            },
            auto_return: 'approved',
            external_reference: JSON.stringify({ numbers, userId, buyerName, buyerPhone }),
            notification_url: `${process.env.SITE_URL}/webhook`,
        };

        const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });
        const preferenceClient = new Preference(client);
        const response = await preferenceClient.create({ body: preference });
        console.log(`[${new Date().toISOString()}] Preferência criada com sucesso, preference_id: ${response.id}, init_point: ${response.init_point}, números: ${numbers.join(', ')}`);

        const purchase = new Purchase({
            buyerName,
            buyerPhone,
            numbers,
            preference_id: response.id,
        });
        await purchase.save();

        res.json({ id: response.id, init_point: response.init_point });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro ao criar preferência:`, error);
        res.status(500).json({ error: 'Erro ao criar preferência' });
    }
});

app.post('/webhook', async (req, res) => {
    const payment = req.body;
    console.log(`[${new Date().toISOString()}] Webhook recebido:`, JSON.stringify(payment, null, 2));
    try {
        if (payment.type === 'payment') {
            const paymentId = payment.data.id;
            const paymentClient = new Payment(client);
            const paymentDetails = await paymentClient.get({ id: paymentId });
            console.log(`[${new Date().toISOString()}] Resposta da API do Mercado Pago:`, JSON.stringify(paymentDetails, null, 2));

            if (paymentDetails.status === 'approved') {
                let externalReference;
                try {
                    externalReference = JSON.parse(paymentDetails.external_reference || '{}');
                } catch (e) {
                    console.error(`[${new Date().toISOString()}] Erro ao parsear external_reference:`, e);
                    return res.sendStatus(400);
                }
                const { numbers, userId, buyerName, buyerPhone } = externalReference;

                const session = await mongoose.startSession();
                session.startTransaction();
                try {
                    const validNumbers = await Comprador.find({
                        number: { $in: numbers },
                        status: 'reservado',
                        userId,
                    }).session(session);
                    if (validNumbers.length !== numbers.length) {
                        await session.abortTransaction();
                        session.endSession();
                        console.error(`[${new Date().toISOString()}] Números não estão reservados para o usuário: ${userId}`);
                        return res.sendStatus(400);
                    }

                    const compradorResult = await Comprador.updateMany(
                        { number: { $in: numbers }, status: 'reservado', userId },
                        { $set: { status: 'vendido', userId: null, timestamp: null } },
                        { session }
                    );
                    console.log(`[${new Date().toISOString()}] Compradores atualizados: ${compradorResult.modifiedCount}`);

                    const purchaseResult = await Purchase.updateMany(
                        { numbers: { $in: numbers }, status: 'pending' },
                        { $set: { status: 'approved', paymentId, date_approved: new Date() } },
                        { session }
                    );
                    console.log(`[${new Date().toISOString()}] Compras atualizadas: ${purchaseResult.modifiedCount}`);

                    await session.commitTransaction();
                    console.log(`[${new Date().toISOString()}] Pagamento ${paymentId} aprovado. Números ${numbers.join(', ')} marcados como vendido.`);
                } catch (error) {
                    await session.abortTransaction();
                    throw error;
                } finally {
                    session.endSession();
                }
            } else {
                console.log(`[${new Date().toISOString()}] Pagamento ${paymentId} não está aprovado. Status: ${paymentDetails.status}`);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro no webhook:`, error);
        res.status(500).json({ error: 'Erro no webhook' });
    }
});

app.get('/health', async (req, res) => {
    try {
        await mongoose.connection.db.admin().ping();
        const count = await Comprador.countDocuments();
        res.status(200).json({ status: 'OK', message: 'Servidor e MongoDB estão funcionando', compradoresCount: count });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Erro no health check:`, error);
        res.status(500).json({ status: 'ERROR', message: 'Erro no servidor ou MongoDB', error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Servidor rodando na porta ${PORT}`);
});

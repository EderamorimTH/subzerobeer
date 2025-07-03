const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const mongoose = require('mongoose');
mongoose.set('strictQuery', true);
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(express.json());
app.use(cors());

// Conectar ao MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('[' + new Date().toISOString() + '] Conectado ao MongoDB');
}).catch((error) => {
    console.error('[' + new Date().toISOString() + '] Erro ao conectar ao MongoDB: ' + error.message);
});

// Schema para números vendidos
const NumberSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    buyerName: String,
    buyerPhone: String,
    status: { type: String, enum: ['reserved', 'sold'], default: 'reserved' }
});

const Number = mongoose.model('Number', NumberSchema);

// Endpoint para verificar a saúde do servidor
app.get('/health', async (req, res) => {
    try {
        const compradoresCount = await Number.countDocuments({ status: 'sold' });
        console.log('[' + new Date().toISOString() + '] Health check: compradoresCount = ' + compradoresCount);
        res.json({ status: 'OK', compradoresCount });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro no health check: ' + error.message);
        res.status(500).json({ error: 'Erro no servidor' });
    }
});

// Endpoint para números disponíveis
app.get('/available_numbers', async (req, res) => {
    try {
        const allNumbers = Array.from({ length: 100 }, (_, i) => String(i + 1).padStart(3, '0'));
        const soldNumbers = await Number.find({ status: 'sold' }).distinct('number');
        console.log('[' + new Date().toISOString() + '] Números vendidos: ' + JSON.stringify(soldNumbers));
        const availableNumbers = allNumbers.filter(num => !soldNumbers.includes(num));
        console.log('[' + new Date().toISOString() + '] Números disponíveis: ' + JSON.stringify(availableNumbers));
        if (availableNumbers.length === 0) {
            console.warn('[' + new Date().toISOString() + '] Nenhum número disponível retornado');
        }
        res.json(availableNumbers);
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao carregar números disponíveis: ' + error.message);
        res.status(500).json({ error: 'Erro ao carregar números' });
    }
});

// Endpoint para reservar números
app.post('/reserve_numbers', async (req, res) => {
    try {
        const { numbers, userId } = req.body;
        if (!numbers || !userId) {
            return res.status(400).json({ error: 'Números ou userId não fornecidos' });
        }
        console.log('[' + new Date().toISOString() + '] Reservando números: ' + JSON.stringify(numbers) + ' para userId: ' + userId);
        
        const existingNumbers = await Number.find({ number: { $in: numbers } });
        if (existingNumbers.length > 0) {
            return res.status(400).json({ error: 'Alguns números já estão reservados ou vendidos' });
        }

        const numberDocs = numbers.map(num => ({ number: num, userId, status: 'reserved' }));
        await Number.insertMany(numberDocs);
        res.json({ success: true });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao reservar números: ' + error.message);
        res.status(500).json({ error: 'Erro ao reservar números' });
    }
});

// Endpoint para verificar reserva
app.post('/check_reservation', async (req, res) => {
    try {
        const { numbers, userId } = req.body;
        if (!numbers || !userId) {
            return res.status(400).json({ error: 'Números ou userId não fornecidos' });
        }
        const existingNumbers = await Number.find({ number: { $in: numbers }, userId: { $ne: userId } });
        const valid = existingNumbers.length === 0;
        console.log('[' + new Date().toISOString() + '] Verificação de reserva: valid = ' + valid);
        res.json({ valid });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao verificar reserva: ' + error.message);
        res.status(500).json({ error: 'Erro ao verificar reserva' });
    }
});

// Endpoint para criar preferência de pagamento
app.post('/create_preference', async (req, res) => {
    try {
        const { quantity, buyerName, buyerPhone, numbers, userId } = req.body;
        if (!quantity || !buyerName || !buyerPhone || !numbers || !userId) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }

        const preference = new Preference(mercadoPagoClient);
        const preferenceData = {
            items: [{
                title: 'Sorteio Sub-zero Beer',
                quantity: parseInt(quantity),
                unit_price: 10.0,
                currency_id: 'BRL'
            }],
            payer: {
                name: buyerName,
                phone: { number: buyerPhone }
            },
            external_reference: userId,
            back_urls: {
                success: 'https://subzerobeer.onrender.com/sorteio.html?status=approved',
                failure: 'https://subzerobeer.onrender.com/sorteio.html?status=rejected',
                pending: 'https://subzerobeer.onrender.com/sorteio.html?status=pending'
            },
            auto_return: 'approved',
            metadata: { numbers }
        };

        const response = await preference.create({ body: preferenceData });
        console.log('[' + new Date().toISOString() + '] Preferência criada: ' + response.id);
        
        await Number.updateMany(
            { number: { $in: numbers }, userId },
            { $set: { buyerName, buyerPhone, status: 'reserved' } }
        );
        
        res.json({ init_point: response.init_point });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao criar preferência: ' + error.message + ' ' + error.stack);
        res.status(500).json({ error: 'Erro ao criar pagamento', details: error.message });
    }
});

// Endpoint para webhooks
app.post('/webhook', async (req, res) => {
    try {
        const { action, data, type } = req.body;
        console.log('[' + new Date().toISOString() + '] Webhook recebido: ' + JSON.stringify(req.body));

        if (type === 'payment' && action === 'payment.updated') {
            const payment = new Payment(mercadoPagoClient);
            const paymentDetails = await payment.get({ id: data.id });
            console.log('[' + new Date().toISOString() + '] Detalhes do pagamento: ' + JSON.stringify(paymentDetails));
            
            if (paymentDetails.status === 'approved') {
                await Number.updateMany(
                    { userId: paymentDetails.external_reference },
                    { $set: { status: 'sold' } }
                );
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro no webhook: ' + error.message);
        res.status(500).json({ error: 'Erro ao processar webhook' });
    }
});

// Endpoint para progresso
app.get('/progress', async (req, res) => {
    try {
        const soldNumbers = await Number.countDocuments({ status: 'sold' });
        const totalNumbers = 100;
        const progress = (soldNumbers / totalNumbers) * 100;
        console.log('[' + new Date().toISOString() + '] Progresso: ' + progress + '%');
        res.json({ progress });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao carregar progresso: ' + error.message);
        res.status(500).json({ error: 'Erro ao carregar progresso' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('[' + new Date().toISOString() + '] Servidor rodando na porta ' + PORT));

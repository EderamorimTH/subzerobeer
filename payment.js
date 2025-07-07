const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const { MercadoPagoConfig, Preference } = require('mercadopago');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔗 Conexão com MongoDB
const uri = process.env.MONGO_URI || 'mongodb+srv://<usuario>:<senha>@cluster.mongodb.net/subzero';
const client = new MongoClient(uri);
let db, NumbersCollection;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('subzero');
        NumbersCollection = db.collection('numbers');
        console.log('✅ Conectado ao MongoDB');
    } catch (error) {
        console.error('❌ Erro ao conectar no MongoDB:', error.message);
    }
}
connectDB();

// 💳 Configuração Mercado Pago
const mercadopago = new MercadoPagoConfig({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN
});

// 🔍 Verificação de status
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 📋 Liberar números expirados e retornar os disponíveis
app.get('/available_numbers', async (req, res) => {
    try {
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        // Libera os expirados
        await NumbersCollection.updateMany(
            {
                status: 'reservado',
                reservedAt: { $lt: fiveMinutesAgo }
            },
            {
                $set: { status: 'disponível' },
                $unset: { userId: "", reservedAt: "" }
            }
        );

        const numbers = await NumbersCollection.find().toArray();
        res.json(numbers);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar números' });
    }
});

// 🟡 Reservar número
app.post('/reserve_numbers', async (req, res) => {
    const { numbers, userId } = req.body;

    try {
        const updates = numbers.map(number =>
            NumbersCollection.updateOne(
                { number, status: 'disponível' },
                {
                    $set: { status: 'reservado', userId, reservedAt: new Date() }
                }
            )
        );
        await Promise.all(updates);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Erro ao reservar' });
    }
});

// 🔍 Verificar reserva
app.post('/check_reservation', async (req, res) => {
    const { numbers, userId } = req.body;
    try {
        const valid = await NumbersCollection.find({
            number: { $in: numbers },
            userId,
            status: 'reservado'
        }).toArray();
        res.json({ valid: valid.length === numbers.length });
    } catch (error) {
        res.status(500).json({ valid: false });
    }
});

// 💰 Criar preferência de pagamento
app.post('/create_preference', async (req, res) => {
    const { buyerName, buyerPhone, quantity, numbers, userId } = req.body;

    try {
        const preference = await new Preference(mercadopago).create({
            body: {
                items: [
                    {
                        title: 'Rifa Sub-Zero Beer',
                        quantity,
                        unit_price: 5
                    }
                ],
                payer: { name: buyerName },
                metadata: { buyerName, buyerPhone, numbers, userId },
                back_urls: {
                    success: 'https://subzerobeer.vercel.app/?status=approved',
                    failure: 'https://subzerobeer.vercel.app/?status=rejected',
                    pending: 'https://subzerobeer.vercel.app/?status=pending'
                },
                auto_return: 'approved'
            }
        });

        res.json({ init_point: preference.init_point });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

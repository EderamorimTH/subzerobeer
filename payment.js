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

// 🔍 Verificação de status do servidor
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 📋 Retorna os 200 números com status correto
app.get('/available_numbers', async (req, res) => {
    try {
        const storedNumbers = await NumbersCollection.find({}).toArray();
        const storedMap = {};
        storedNumbers.forEach(item => {
            storedMap[item.number] = item;
        });

        const allNumbers = Array.from({ length: 200 }, (_, i) => {
            const number = String(i + 1).padStart(3, '0');
            return storedMap[number] || { number, status: 'disponível' };
        });

        res.json(allNumbers);
    } catch (error) {
        console.error('Erro ao buscar números:', error.message);
        res.status(500).json({ error: 'Erro ao buscar números' });
    }
});

// 🟡 Reservar números
app.post('/reserve_numbers', async (req, res) => {
    const { numbers, userId } = req.body;

    try {
        const updates = numbers.map(number =>
            NumbersCollection.updateOne(
                { number, status: 'disponível' },
                {
                    $set: {
                        status: 'reservado',
                        userId,
                        reservedAt: new Date()
                    }
                },
                { upsert: true }
            )
        );
        await Promise.all(updates);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Erro ao reservar' });
    }
});

// 🔍 Verificar se a reserva ainda é válida
app.post('/check_reservation', async (req, res) => {
    const { numbers, userId } = req.body;

    try {
        const result = await NumbersCollection.find({
            number: { $in: numbers },
            userId,
            status: 'reservado'
        }).toArray();

        res.json({ valid: result.length === numbers.length });
    } catch (error) {
        res.status(500).json({ valid: false });
    }
});

// ✅ Liberar número manualmente após expiração
app.post('/release_number', async (req, res) => {
    const { number, userId } = req.body;

    if (!number || !userId) {
        return res.status(400).json({ success: false, error: 'Parâmetros ausentes.' });
    }

    try {
        const result = await NumbersCollection.updateOne(
            { number, userId, status: 'reservado' },
            {
                $set: {
                    status: 'disponível',
                    userId: null,
                    updatedAt: new Date()
                }
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Número não encontrado ou já está disponível.'
            });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 💰 Criar preferência de pagamento Mercado Pago
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
        console.error('Erro ao criar preferência:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

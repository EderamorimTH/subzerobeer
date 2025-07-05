require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configure Mercado Pago
const mercadopago = new MercadoPagoConfig({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN || 'APP_USR-7275526477888809-070301-eea6b39a6469ea60b9291fcbc20f8fdc-233975707'
});

// Configurar Mongoose strictQuery
mongoose.set('strictQuery', true);

// Conexão com o MongoDB
async function connectToMongoDB() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost/subzerobeer';
    console.log('[' + new Date().toISOString() + '] Tentando conectar ao MongoDB com URI:', mongoUri.replace(/:.*@/, ':<hidden>@')); // Log para depuração
    try {
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 30000,
            connectTimeoutMS: 30000,
            retryWrites: true,
            retryReads: true
        });
        console.log('[' + new Date().toISOString() + '] Conectado ao MongoDB');
    } catch (err) {
        console.error('[' + new Date().toISOString() + '] Erro ao conectar ao MongoDB:', err.message);
        process.exit(1);
    }
}

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

// Schema para compras (coleção 'compradores' no MongoDB)
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
    try {
        const count = await Number.countDocuments();
        if (count === 0) {
            const numbers = Array.from({ length: 150 }, (_, i) => ({
                number: String(i + 1).padStart(3, '0'),
                status: 'disponível'
            }));
            await Number.insertMany(numbers);
            console.log('[' + new Date().toISOString() + '] Números inicializados');
        }
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao inicializar números:', error.message);
    }
}

// Rota de health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', mongodbConnected: mongoose.connection.readyState === 1 });
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
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
            return res.status(400).json({ success: false, message: 'Números ou userId inválidos' });
        }
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
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId) {
            return res.status(400).json({ valid: false, message: 'Números ou userId inválidos' });
        }
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
        res.status(500).json({ valid: false, message: 'Erro ao verificar reservas' });
    }
});

// Rota para criar preferência de pagamento
app.post('/create_preference', async (req, res) => {
    const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
    try {
        if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId || !buyerName || !buyerPhone || !quantity) {
            return res.status(400).json({ error: 'Dados incompletos' });
        }
        const preference = new Preference(mercadopago);
        const preferenceData = {
            items: [{
                title: 'Sub-zero Beer Sorteio',
                unit_price: 10.0,
                quantity: parseInt(quantity),
            }],
            back_urls: {
                success: 'https://ederamorimth.github.io/subzerobeer/index.html?status=approved',
                failure: 'https://ederamorimth.github.io/subzerobeer/index.html?status=rejected',
                pending: 'https://ederamorimth.github.io/subzerobeer/index.html?status=pending'
            },
            auto_return: 'approved',
            external_reference: JSON.stringify({ numbers, userId, buyerName, buyerPhone })
        };

        const response = await preference.create({ body: preferenceData });
        await Number.updateMany(
            { number: { $in: numbers } },
            { $set: { buyerName, buyerPhone } }
        );
        await Purchase.create({ numbers, userId, buyerName, buyerPhone, status: 'pending' });
        res.json({ init_point: response.init_point });
    } catch (error) {
        console.error('[' + new Date().toISOString() + '] Erro ao criar preferência:', error.message);
        res.status(500).json({ error: 'Erro ao criar preferênciaсию

System: * Today's date and time is 04:03 PM -04 on Saturday, July 05, 2025.

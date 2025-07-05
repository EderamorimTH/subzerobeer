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
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/subzerobeer', {
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

// Iniciar servidor após conexão com MongoDB
async function startServer() {
    await connectToMongoDB();
    await initializeNumbers();
    app.listen(port, () => {
        console.log('[' + new Date().toISOString() + '] Servidor rodando na porta ' + port);
    });
}

startServer();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
const port = process.env.PORT || 10000;

// Configurar Mercado Pago
if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
  console.error('[' + new Date().toISOString() + '] ACCESS_TOKEN do Mercado Pago não configurado');
  process.exit(1);
}

const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
});

mongoose.set('strictQuery', true);

const mongoURI = process.env.MONGO_URI || 'mongodb+srv://Amorim:<db_password>@cluster0.8vhg4ws.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('[' + new Date().toISOString() + '] Conectado ao MongoDB com sucesso'))
  .catch((err) => {
    console.error('[' + new Date().toISOString() + '] Erro ao conectar ao MongoDB:', err);
    process.exit(1);
  });

app.use(cors({ origin: 'https://ederamorimth.github.io' }));
app.use(express.json());

const numberSchema = new mongoose.Schema({ number: String, status: String });
const Number = mongoose.model('Number', numberSchema);

const pendingNumberSchema = new mongoose.Schema({
  number: String,
  userId: String,
  buyerName: String,
  buyerPhone: String,
  reservedAt: { type: Date, default: Date.now, expires: 300 },
});
const PendingNumber = mongoose.model('PendingNumber', pendingNumberSchema);

const soldNumberSchema = new mongoose.Schema({
  number: String,
  buyerName: String,
  buyerPhone: String,
  status: String,
  timestamp: Date,
});
const SoldNumber = mongoose.model('SoldNumber', soldNumberSchema);

const purchaseSchema = new mongoose.Schema({
  buyerName: String,
  buyerPhone: String,
  numbers: [String],
  status: String,
  date_approved: Date,
  paymentId: String,
});
const Purchase = mongoose.model('Purchase', purchaseSchema);

const winnerSchema = new mongoose.Schema({
  buyerName: String,
  buyerPhone: String,
  winningNumber: String,
  numbers: [String],
  drawDate: Date,
  prize: String,
  photoUrl: String,
});
const Winner = mongoose.model('Winner', winnerSchema);

async function initializeNumbers() {
  const count = await Number.countDocuments();
  if (count === 0) {
    const numbers = Array.from({ length: 150 }, (_, i) => ({
      number: String(i + 1).padStart(3, '0'),
      status: 'disponivel',
    }));
    await Number.insertMany(numbers);
  }
}

async function cleanupExpiredReservations() {
  const expired = await PendingNumber.find({ reservedAt: { $lte: new Date(Date.now() - 300000) } });
  if (expired.length > 0) {
    const expiredNumbers = expired.map(p => p.number);
    await Number.updateMany({ number: { $in: expiredNumbers }, status: 'reservado' }, { status: 'disponivel' });
    await PendingNumber.deleteMany({ number: { $in: expiredNumbers } });
  }
}

mongoose.connection.once('open', async () => {
  await initializeNumbers();
  setInterval(cleanupExpiredReservations, 60 * 1000);
});

app.post('/create_preference', async (req, res) => {
  const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !userId || !buyerName || !buyerPhone || !quantity) {
    return res.status(400).json({ error: 'Dados inválidos fornecidos' });
  }
  try {
    const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (validNumbers.length !== numbers.length) {
      await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'disponivel' });
      await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
      return res.status(400).json({ error: 'Alguns números não estão mais reservados' });
    }

    await PendingNumber.updateMany(
      { number: { $in: numbers }, userId },
      { $set: { buyerName, buyerPhone } }
    );

    const preference = {
      items: [
        {
          title: `Compra de ${quantity} numero(s) para sorteio`,
          unit_price: 10.0,
          quantity: quantity,
        },
      ],
      back_urls: {
        success: 'https://ederamorimth.github.io/subzerobeer/index.html?status=approved',
        failure: 'https://ederamorimth.github.io/subzerobeer/index.html?status=rejected',
        pending: 'https://ederamorimth.github.io/subzerobeer/index.html?status=pending',
      },
      auto_return: 'approved',
      external_reference: numbers.join(','),
      notification_url: 'https://subzerobeer.onrender.com/webhook',
    };

    const preferenceClient = new Preference(mercadopago);
    const response = await preferenceClient.create(preference);
    res.json({ init_point: response.body.init_point });
  } catch (error) {
    console.error('Erro ao criar preferência:', error);
    res.status(500).json({ error: 'Erro ao criar preferência' });
  }
});

app.post('/webhook', async (req, res) => {
  const { type, data } = req.body;
  if (type !== 'payment') return res.status(200).send('OK');

  const paymentId = data?.id;
  if (!paymentId) return res.status(400).json({ error: 'paymentId não fornecido' });

  try {
    const paymentClient = new Payment(mercadopago);
    const payment = await paymentClient.get({ id: paymentId });
    const paymentStatus = payment.body.status;
    const numbers = payment.body.external_reference?.split(',');

    if (!numbers || numbers.length === 0) return res.status(400).json({ error: 'Números inválidos' });

    const pending = await PendingNumber.find({ number: { $in: numbers } });
    if (pending.length !== numbers.length) {
      await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'disponivel' });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      return res.status(400).json({ error: 'Números não encontrados' });
    }

    if (paymentStatus === 'approved') {
      await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'vendido' });
      await SoldNumber.insertMany(
        pending.map(p => ({ number: p.number, buyerName: p.buyerName, buyerPhone: p.buyerPhone, status: 'vendido', timestamp: new Date() }))
      );
      await Purchase.create({
        buyerName: pending[0].buyerName,
        buyerPhone: pending[0].buyerPhone,
        numbers,
        status: 'approved',
        date_approved: new Date(),
        paymentId,
      });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
    } else {
      await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'disponivel' });
      await PendingNumber.deleteMany({ number: { $in: numbers } });
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

app.listen(port, () => {
  console.log('[' + new Date().toISOString() + '] Servidor rodando na porta', port);
});

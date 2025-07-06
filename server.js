require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
const port = process.env.PORT || 10000;

if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
  console.error(`[${new Date().toISOString()}] ACCESS_TOKEN do Mercado Pago não configurado.`);
  process.exit(1);
}

const mercadopago = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN });

mongoose.set('strictQuery', true);
const mongoURI = process.env.MONGO_URI;

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log(`[${new Date().toISOString()}] Conectado ao MongoDB com sucesso`))
  .catch((err) => {
    console.error(`[${new Date().toISOString()}] Erro ao conectar ao MongoDB:`, err);
    process.exit(1);
  });

app.use(cors({ origin: 'https://ederamorimth.github.io' }));
app.use(express.json());

// Schemas
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
      status: 'disponivel'
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

// --- ENDPOINTS --- //

app.get('/health', (_, res) => res.json({ status: 'OK' }));

app.get('/get-page-password', (req, res) => {
  const passwordHash = process.env.PAGE_PASSWORD;
  if (!passwordHash) return res.status(500).json({ error: 'Variável de ambiente não configurada' });
  res.json({ passwordHash });
});

app.get('/available_numbers', async (_, res) => {
  try {
    const numbers = await Number.find({}, 'number status');
    res.json(numbers);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao buscar números' });
  }
});

app.post('/reserve_numbers', async (req, res) => {
  const { numbers, userId } = req.body;
  if (!numbers || !Array.isArray(numbers) || !userId) return res.status(400).json({ error: 'Dados inválidos' });

  const available = await Number.find({ number: { $in: numbers }, status: 'disponivel' });
  if (available.length !== numbers.length) return res.json({ success: false, message: 'Alguns números indisponíveis' });

  await Number.updateMany({ number: { $in: numbers } }, { status: 'reservado' });
  await PendingNumber.insertMany(numbers.map(n => ({ number: n, userId })));
  res.json({ success: true });
});

app.post('/check_reservation', async (req, res) => {
  const { numbers, userId } = req.body;
  const valid = await PendingNumber.find({ number: { $in: numbers }, userId });

  if (valid.length !== numbers.length) {
    await Number.updateMany({ number: { $in: numbers }, status: 'reservado' }, { status: 'disponivel' });
    await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
    return res.json({ valid: false });
  }
  res.json({ valid: true });
});

app.post('/create_preference', async (req, res) => {
  const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
  const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
  if (validNumbers.length !== numbers.length) return res.status(400).json({ error: 'Números não reservados' });

  await PendingNumber.updateMany({ number: { $in: numbers }, userId }, { $set: { buyerName, buyerPhone } });

  const preference = {
    items: [{ title: `Compra de ${quantity} número(s)`, unit_price: 10.0, quantity }],
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
});

app.post('/webhook', async (req, res) => {
  const { type, data } = req.body;
  if (type !== 'payment') return res.status(200).send('OK');

  const paymentClient = new Payment(mercadopago);
  const payment = await paymentClient.get({ id: data.id });
  const { status: paymentStatus, external_reference } = payment.body;
  const numbers = external_reference?.split(',');

  if (!numbers || !Array.isArray(numbers)) return res.status(400).json({ error: 'Números inválidos' });

  const pending = await PendingNumber.find({ number: { $in: numbers } });

  if (paymentStatus === 'approved') {
    await Number.updateMany({ number: { $in: numbers } }, { status: 'vendido' });
    await SoldNumber.insertMany(pending.map(p => ({ number: p.number, buyerName: p.buyerName, buyerPhone: p.buyerPhone, status: 'vendido', timestamp: new Date() })));
    await Purchase.create({ buyerName: pending[0].buyerName, buyerPhone: pending[0].buyerPhone, numbers, status: 'approved', date_approved: new Date(), paymentId: data.id });
    await PendingNumber.deleteMany({ number: { $in: numbers } });
  } else {
    await Number.updateMany({ number: { $in: numbers } }, { status: 'disponivel' });
    await PendingNumber.deleteMany({ number: { $in: numbers } });
  }
  res.status(200).send('OK');
});

app.get('/purchases', async (_, res) => {
  const purchases = await Purchase.find({ status: 'approved' });
  res.json(purchases);
});

app.get('/winners', async (_, res) => {
  const winners = await Winner.find();
  res.json(winners);
});

app.post('/save_winner', async (req, res) => {
  const { buyerName, buyerPhone, winningNumber, numbers, drawDate, prize, photoUrl } = req.body;
  if (!buyerName || !buyerPhone || !winningNumber || !numbers || !drawDate || !prize || !photoUrl) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }
  await Winner.create({ buyerName, buyerPhone, winningNumber, numbers, drawDate, prize, photoUrl });
  res.json({ message: 'Ganhador salvo com sucesso' });
});

app.listen(port, () => {
  console.log(`[${new Date().toISOString()}] Servidor rodando na porta ${port}`);
});

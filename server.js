const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 10000;

// Configurar strictQuery para evitar aviso de depreciação
mongoose.set('strictQuery', true);

// Configuração da URI do MongoDB
const mongoURI = process.env.MONGO_URI || 'mongodb+srv://Amorim:<db_password>@cluster0.8vhg4ws.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

// Conexão com o MongoDB
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Conectado ao MongoDB com sucesso'))
.catch((err) => console.error('Erro ao conectar ao MongoDB:', err));

// Middleware
app.use(cors());
app.use(express.json());

// Schema para números disponíveis
const numberSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  status: { type: String, enum: ['disponível', 'reservado', 'vendido'], default: 'disponível' },
});
const Number = mongoose.model('Number', numberSchema);

// Schema para números pendentes (com TTL de 5 minutos)
const pendingNumberSchema = new mongoose.Schema({
  number: { type: String, required: true },
  userId: String,
  buyerName: String,
  buyerPhone: String,
  reservedAt: { type: Date, default: Date.now, expires: 300 }, // Expira após 5 minutos (300 segundos)
});
const PendingNumber = mongoose.model('PendingNumber', pendingNumberSchema);

// Schema para números vendidos
const soldNumberSchema = new mongoose.Schema({
  number: { type: String, required: true },
  buyerName: String,
  buyerPhone: String,
  status: { type: String, default: 'vendido' },
  timestamp: { type: Date, default: Date.now },
});
const SoldNumber = mongoose.model('SoldNumber', soldNumberSchema);

// Inicializar números no MongoDB
async function initializeNumbers() {
  const count = await Number.countDocuments();
  if (count === 0) {
    console.log('[' + new Date().toISOString() + '] Inicializando coleção de números');
    const numbers = Array.from({ length: 150 }, (_, i) => ({
      number: String(i + 1).padStart(3, '0'),
      status: 'disponível',
    }));
    await Number.insertMany(numbers);
    console.log('[' + new Date().toISOString() + '] 150 números inicializados como disponíveis');
  }
}

// Atualizar números expirados para disponível
async function cleanupExpiredReservations() {
  const expired = await PendingNumber.find({ reservedAt: { $lte: new Date(Date.now() - 300000) } });
  if (expired.length > 0) {
    const expiredNumbers = expired.map(p => p.number);
    await Number.updateMany(
      { number: { $in: expiredNumbers }, status: 'reservado' },
      { status: 'disponível' }
    );
    await PendingNumber.deleteMany({ number: { $in: expiredNumbers } });
    console.log('[' + new Date().toISOString() + '] Números expirados liberados:', expiredNumbers);
  }
}

// Chamar inicialização e configurar cleanup
mongoose.connection.once('open', async () => {
  await initializeNumbers();
  // Executar cleanup a cada minuto
  setInterval(cleanupExpiredReservations, 60 * 1000);
});

// Endpoint para verificar saúde do backend
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Endpoint para obter números disponíveis
app.get('/available_numbers', async (req, res) => {
  try {
    const numbers = await Number.find({}, 'number status');
    res.json(numbers);
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao buscar números:', error.message);
    res.status(500).json({ error: 'Erro ao buscar números' });
  }
});

// Endpoint para reservar números
app.post('/reserve_numbers', async (req, res) => {
  const { numbers, userId } = req.body;
  try {
    const available = await Number.find({ number: { $in: numbers }, status: 'disponível' });
    if (available.length !== numbers.length) {
      return res.json({ success: false, message: 'Alguns números não estão disponíveis' });
    }

    await Number.updateMany(
      { number: { $in: numbers }, status: 'disponível' },
      { status: 'reservado' }
    );
    await PendingNumber.insertMany(
      numbers.map(number => ({ number, userId, reservedAt: new Date() }))
    );
    console.log('[' + new Date().toISOString() + '] Números reservados:', numbers);
    res.json({ success: true });
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao reservar números:', error.message);
    res.status(500).json({ error: 'Erro ao reservar números' });
  }
});

// Endpoint para verificar reservas
app.post('/check_reservation', async (req, res) => {
  const { numbers, userId } = req.body;
  try {
    const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (validNumbers.length !== numbers.length) {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
      res.json({ valid: false });
    } else {
      res.json({ valid: true });
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao verificar reserva:', error.message);
    res.status(500).json({ error: 'Erro ao verificar reserva' });
  }
});

// Endpoint para criar preferência de pagamento
app.post('/create_preference', async (req, res) => {
  const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
  try {
    const validNumbers = await PendingNumber.find({ number: { $in: numbers }, userId });
    if (validNumbers.length !== numbers.length) {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      await PendingNumber.deleteMany({ number: { $in: numbers }, userId });
      return res.status(400).json({ error: 'Alguns números não estão mais reservados' });
    }

    // Simulação de preferência do Mercado Pago
    const preferenceData = { init_point: 'https://www.mercadopago.com/mock_payment', external_reference: numbers.join(',') };
    await PendingNumber.updateMany(
      { number: { $in: numbers }, userId },
      { $set: { buyerName, buyerPhone } }
    );
    res.json(preferenceData);
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao criar preferência:', error.message);
    res.status(500).json({ error: 'Erro ao criar preferência' });
  }
});

// Webhook para processar notificações de pagamento do Mercado Pago
app.post('/webhook', async (req, res) => {
  const { data } = req.body;
  const paymentStatus = data?.status;
  const numbers = data?.external_reference?.split(',');
  try {
    if (paymentStatus === 'approved') {
      const pending = await PendingNumber.find({ number: { $in: numbers } });
      if (pending.length === numbers.length) {
        await Number.updateMany(
          { number: { $in: numbers }, status: 'reservado' },
          { status: 'vendido' }
        );
        await SoldNumber.insertMany(
          pending.map(p => ({
            number: p.number,
            buyerName: p.buyerName,
            buyerPhone: p.buyerPhone,
            status: 'vendido',
          }))
        );
        await PendingNumber.deleteMany({ number: { $in: numbers } });
        console.log('[' + new Date().toISOString() + '] Pagamento aprovado, números marcados como vendido:', numbers);
      }
    } else if (paymentStatus === 'rejected' || paymentStatus === 'pending') {
      await Number.updateMany(
        { number: { $in: numbers }, status: 'reservado' },
        { status: 'disponível' }
      );
      await PendingNumber.deleteMany({ number: { $in: numbers } });
      console.log('[' + new Date().toISOString() + '] Pagamento ' + paymentStatus + ', números liberados:', numbers);
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro no webhook:', error.message);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

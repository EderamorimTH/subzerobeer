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

// Schema para números
const numberSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  status: { type: String, enum: ['disponível', 'reservado', 'vendido'], default: 'disponível' },
});
const Number = mongoose.model('Number', numberSchema);

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

// Chamar inicialização após conexão
mongoose.connection.once('open', async () => {
  await initializeNumbers();
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
    const updated = await Number.updateMany(
      { number: { $in: numbers }, status: 'disponível' },
      { status: 'reservado' }
    );
    if (updated.modifiedCount === numbers.length) {
      res.json({ success: true });
    } else {
      res.json({ success: false, message: 'Alguns números não estão disponíveis' });
    }
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao reservar números:', error.message);
    res.status(500).json({ error: 'Erro ao reservar números' });
  }
});

// Endpoint para verificar reservas
app.post('/check_reservation', async (req, res) => {
  const { numbers, userId } = req.body;
  try {
    const validNumbers = await Number.find({ number: { $in: numbers }, status: 'reservado' });
    res.json({ valid: validNumbers.length === numbers.length });
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao verificar reserva:', error.message);
    res.status(500).json({ error: 'Erro ao verificar reserva' });
  }
});

// Endpoint para criar preferência de pagamento (exemplo simplificado)
app.post('/create_preference', async (req, res) => {
  const { numbers, userId, buyerName, buyerPhone, quantity } = req.body;
  try {
    // Atualizar números para vendido
    await Number.updateMany(
      { number: { $in: numbers }, status: 'reservado' },
      { status: 'vendido' }
    );
    // Registrar números vendidos
    await SoldNumber.insertMany(
      numbers.map(number => ({ number, buyerName, buyerPhone, status: 'vendido' }))
    );
    // Simulação de preferência do Mercado Pago
    res.json({ init_point: 'https://www.mercadopago.com/mock_payment' });
  } catch (error) {
    console.error('[' + new Date().toISOString() + '] Erro ao criar preferência:', error.message);
    res.status(500).json({ error: 'Erro ao criar preferência' });
  }
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

const express = require('express');
const mongoose = require('mongoose');
const app = express();
const port = process.env.PORT || 10000;

// Configurar strictQuery para evitar aviso de depreciação
mongoose.set('strictQuery', true);

// Configuração da URI do MongoDB usando variável de ambiente
const mongoURI = process.env.MONGO_URI || 'mongodb+srv://Amorim:<db_password>@cluster0.8vhg4ws.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

// Conexão com o MongoDB
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Conectado ao MongoDB com sucesso'))
.catch((err) => console.error('Erro ao conectar ao MongoDB:', err));

// Middleware para parsing de JSON
app.use(express.json());

// Rotas e demais configurações
app.get('/', (req, res) => {
  res.send('Servidor SubzeroBeer rodando!');
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

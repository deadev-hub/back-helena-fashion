import app from './app.js';

const PORT = parseInt(process.env.PORT || '3001', 10);

app.listen(PORT, () => {
  console.log(`🚀 Helena Fashion Hair API rodando em http://localhost:${PORT}`);
});
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const goalRoutes = require('./routes/goals');
const testRoutes = require('./routes/tests');
const agentRoutes = require('./routes/agent');
const projectRoutes = require('./routes/projects');
const conversationRoutes = require('./routes/conversations');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/goals', goalRoutes);
app.use('/api/tests', testRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/conversations', conversationRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Agentforce Testing Center running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`API Health: http://localhost:${PORT}/health`);
});
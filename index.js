const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const app = express();
const inventoryController = require('./src/controllers/inventory.controller');
const { authenticateToken } = require('./src/middleware/auth.middleware');
const upload = require('./src/middleware/multer.middleware');

app.use(cors());
app.use(express.json());

// Auth Routes (Public)
app.post('/api/auth/register', inventoryController.registerUser);
app.post('/api/auth/login', inventoryController.loginUser);
app.post('/api/auth/google', inventoryController.googleLogin);
app.post('/api/auth/admin-login', inventoryController.adminLogin);

// Protected Routes (Require JWT)
app.use('/api/inventory', authenticateToken);
app.use('/api/products', authenticateToken);
app.use('/api/stock-logs', authenticateToken);
app.use('/api/analysis', authenticateToken);
app.use('/api/users', authenticateToken);
app.use('/sync', authenticateToken);

// Administrative Endpoints
app.get('/api/users', inventoryController.getUsers);
app.get('/api/inventory', inventoryController.getInventory);
app.get('/api/products', inventoryController.getProducts);
app.post('/api/products', upload.single('image'), inventoryController.addProduct);
app.get('/api/stock-logs', inventoryController.getStockLogs);
app.get('/api/analysis', inventoryController.getAnalysis);

// Mobile Sync Endpoint
app.post('/api/inventory/sync', authenticateToken, inventoryController.syncInventory);
app.post('/sync', authenticateToken, inventoryController.syncInventory);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

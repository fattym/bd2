const { PrismaClient } = require('@prisma/client');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const cloudinary = require('../utils/cloudinary');
const prisma = new PrismaClient();
const googleClient = new OAuth2Client();

const generateToken = (user) => {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role || 'user' },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: '7d' }
  );
};

/**
 * Handles Standard User Login
 * Method: POST /api/auth/login
 */
exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = generateToken(user);

    res.status(200).json({
      message: "Login successful",
      token,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (error) {
    res.status(500).json({ error: "Login failed", details: error.message });
  }
};

/**
 * Handles Admin Login for the Dashboard
 * Method: POST /api/auth/admin-login
 */
exports.adminLogin = async (req, res) => {
  const { email, password } = req.body;

  // Simple check for demonstration. 
  // In production, fetch from a DB and verify hashed passwords.
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@retailpro.com';
  const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'password123';

  if (email === ADMIN_EMAIL && password === ADMIN_PASS) {
    const token = jwt.sign(
      { userId: 'admin', email: ADMIN_EMAIL, role: 'admin' },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      message: "Admin login successful",
      token,
      user: { name: "System Admin", email: ADMIN_EMAIL, role: 'admin' }
    });
  }

  res.status(401).json({ error: "Invalid admin credentials" });
};

/**
 * Handles Google Login
 * Method: POST /api/auth/google
 */
exports.googleLogin = async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "Google ID Token is required" });
  }

  try {
    // Verify the ID Token
    // Note: In production, you MUST provide the CLIENT_ID here
    const ticket = await googleClient.verifyIdToken({
      idToken,
      // audience: process.env.GOOGLE_CLIENT_ID, 
    });
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Find or Create user in database
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split('@')[0],
          region: "Social User",
        }
      });
    }

    const token = generateToken(user);

    res.status(200).json({
      message: "Login successful",
      token,
      user
    });

  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(401).json({ error: "Invalid Google Token", details: error.message });
  }
};

/**
 * Handles batch synchronization from mobile devices
 * Method: POST /api/inventory/sync
 */
exports.syncInventory = async (req, res) => {
  const { updates } = req.body; // Array of { barcode, change, timestamp, staffId }

  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: "Invalid sync data format." });
  }

  // Use userId from authenticated token
  const targetUserId = req.user?.userId;

  if (!targetUserId) {
    return res.status(401).json({ error: "Unauthorized. User ID missing from token." });
  }

  const results = { success: [], failed: [] };

  try {
    await prisma.$transaction(async (tx) => {
      for (const update of updates) {
        try {
          // 1. Find product by barcode AND user_id
          const product = await tx.product.findUnique({
            where: { 
              barcode_user_id: {
                barcode: update.barcode,
                user_id: targetUserId
              }
            }
          });

          if (!product) throw new Error(`Barcode ${update.barcode} not found for user ${targetUserId}`);

          // 2. Update the Inventory table
          await tx.inventory.update({
            where: { product_id: product.id },
            data: {
              current_quantity: {
                increment: update.change
              },
              last_updated: new Date()
            }
          });

          // 3. Create a Stock Log
          await tx.stockLog.create({
            data: {
              product_id: product.id,
              user_id: targetUserId,
              change_amount: update.change,
              reason: update.change < 0 ? 'sale' : 'restock',
              staff_id: update.staffId,
              timestamp: new Date(update.timestamp)
            }
          });

          results.success.push(update.barcode);
        } catch (error) {
          results.failed.push({ barcode: update.barcode, error: error.message });
        }
      }
    });

    res.status(200).json({
      message: "Sync completed",
      syncedCount: results.success.length,
      errors: results.failed
    });

  } catch (globalError) {
    res.status(500).json({ error: "Transaction failed", details: globalError.message });
  }
};

/**
 * Get all inventory items with product and user details
 * Method: GET /api/inventory
 */
exports.getInventory = async (req, res) => {
  const { userId } = req.query;
  const isReqAdmin = req.user.role === 'admin';
  
  try {
    // If admin and userId query provided, use it. Otherwise if not admin, force their own userId.
    const targetUserId = isReqAdmin ? (userId || undefined) : req.user.userId;
    const where = targetUserId ? { user_id: targetUserId } : {};

    const inventory = await prisma.inventory.findMany({
      where,
      include: {
        product: true,
        user: true
      }
    });
    res.status(200).json(inventory);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch inventory", details: error.message });
  }
};

/**
 * Get all products
 * Method: GET /api/products
 */
exports.getProducts = async (req, res) => {
  const { userId } = req.query;
  const isReqAdmin = req.user.role === 'admin';

  try {
    const targetUserId = isReqAdmin ? (userId || undefined) : req.user.userId;
    const where = targetUserId ? { user_id: targetUserId } : {};

    const products = await prisma.product.findMany({
      where,
      include: {
        user: true
      }
    });
    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch products", details: error.message });
  }
};

/**
 * Add a new product and initialize its inventory
 * Method: POST /api/products
 */
exports.addProduct = async (req, res) => {
  const { barcode, name, userId } = req.body;
  const isReqAdmin = req.user.role === 'admin';

  // Regular users can only add products to their own account
  const targetUserId = isReqAdmin ? userId : req.user.userId;

  if (!barcode || !targetUserId) {
    return res.status(400).json({ error: "Barcode and targetUserId are required" });
  }

  try {
    let imageUrl = null;

    // 1. Upload image to Cloudinary if file exists
    if (req.file) {
      const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: 'retail_products' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });
      imageUrl = result.secure_url;
    }

    const result = await prisma.$transaction(async (tx) => {
      // 2. Create product
      const product = await tx.product.create({
        data: {
          barcode,
          name,
          image_url: imageUrl,
          user_id: targetUserId
        }
      });

      // 3. Initialize inventory
      await tx.inventory.create({
        data: {
          product_id: product.id,
          user_id: targetUserId,
          current_quantity: 0
        }
      });

      return product;
    });

    res.status(201).json(result);
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "Product with this barcode already exists for this user" });
    }
    res.status(500).json({ error: "Failed to add product", details: error.message });
  }
};

/**
 * Get all stock logs
 * Method: GET /api/stock-logs
 */
exports.getStockLogs = async (req, res) => {
  const { userId } = req.query;
  const isReqAdmin = req.user.role === 'admin';

  try {
    const targetUserId = isReqAdmin ? (userId || undefined) : req.user.userId;
    const where = targetUserId ? { user_id: targetUserId } : {};

    const logs = await prisma.stockLog.findMany({
      where,
      include: {
        product: true,
        user: true
      },
      orderBy: {
        timestamp: 'desc'
      },
      take: 50
    });
    res.status(200).json(logs);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch stock logs", details: error.message });
  }
};
/**
 * Get analysis of product performance across shops and regions
 * Method: GET /api/analysis
 */
exports.getAnalysis = async (req, res) => {
  try {
    // 1. Fetch all inventory items (base for mapping products to shops)
    const inventoryItems = await prisma.inventory.findMany({
      include: {
        product: true,
        user: true
      }
    });

    // 2. Fetch all stock logs to calculate sales/restocks
    const stockLogs = await prisma.stockLog.findMany();

    // 3. Map inventory items to performance metrics
    const analysis = inventoryItems.map(item => {
      const itemLogs = stockLogs.filter(log => 
        log.product_id === item.product_id && log.user_id === item.user_id
      );

      const totalSales = itemLogs
        .filter(log => log.change_amount < 0)
        .reduce((sum, log) => sum + Math.abs(log.change_amount), 0);

      const totalRestocks = itemLogs
        .filter(log => log.change_amount > 0)
        .reduce((sum, log) => sum + log.change_amount, 0);

      return {
        id: `${item.product_id}-${item.user_id}`,
        productName: item.product.name,
        barcode: item.product.barcode,
        shopName: item.user.name,
        region: item.user.region,
        currentStock: item.current_quantity,
        totalSales,
        totalRestocks,
        turnoverRate: totalSales > 0 ? (totalSales / (totalSales + item.current_quantity)).toFixed(2) : 0
      };
    });

    res.status(200).json(analysis);
  } catch (error) {
    res.status(500).json({ error: "Analysis generation failed", details: error.message });
  }
};

/**
 * Register a new shop/user from the mobile app
 * Method: POST /api/auth/register
 */
exports.registerUser = async (req, res) => {
  const { email, name, password, region, latitude, longitude } = req.body;

  if (!email || !name || !password) {
    return res.status(400).json({ error: "Email, shop name, and password are required" });
  }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        password, // In production, hash this!
        region,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null
      }
    });

    res.status(201).json({
      message: "Registration successful",
      user
    });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ error: "A shop with this email already exists" });
    }
    res.status(500).json({ error: "Registration failed", details: error.message });
  }
};

/**
 * Get all users
 * Method: GET /api/users
 */
exports.getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users", details: error.message });
  }
};
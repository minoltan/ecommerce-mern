const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./shared/config/swagger');
const { connect } = require('./shared/config/db');
const env = require('./shared/config/env');
const errorMiddleware = require('./shared/middleware/error.middleware');

// Route modules
const userRoutes = require('./modules/user/user.routes');
const productRoutes = require('./modules/product/product.routes');
const cartRoutes = require('./modules/cart/cart.routes');
const orderRoutes = require('./modules/order/order.routes');
const paymentRoutes = require('./modules/payment/payment.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const notificationRoutes = require('./modules/notification/notification.routes');

// Domain event handlers
const { registerHandlers: registerOrderHandlers } = require('./modules/order/order.events');
const { registerHandlers: registerInventoryHandlers } = require('./modules/inventory/inventory.events');
const { registerHandlers: registerPaymentHandlers } = require('./modules/payment/payment.events');
const { registerHandlers: registerNotificationHandlers } = require('./modules/notification/notification.events');

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', env: env.NODE_ENV }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { explorer: true }));

app.use('/api/v1/users', userRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/inventory', inventoryRoutes);
app.use('/api/v1/notifications', notificationRoutes);

app.use(errorMiddleware);

const start = async () => {
  registerOrderHandlers();
  registerInventoryHandlers();
  registerPaymentHandlers();
  registerNotificationHandlers();

  await connect();
  app.listen(env.PORT, () => console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`));
};

if (require.main === module) {
  start();
}

module.exports = app;

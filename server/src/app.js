import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './shared/config/swagger.js';
import env from './shared/config/env.js';
import errorMiddleware from './shared/middleware/error.middleware.js';

// Route modules
import userRoutes from './modules/user/user.routes.js';
import productRoutes from './modules/product/product.routes.js';
import cartRoutes from './modules/cart/cart.routes.js';
import orderRoutes from './modules/order/order.routes.js';
import paymentRoutes from './modules/payment/payment.routes.js';
import inventoryRoutes from './modules/inventory/inventory.routes.js';
import notificationRoutes from './modules/notification/notification.routes.js';

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

export default app;

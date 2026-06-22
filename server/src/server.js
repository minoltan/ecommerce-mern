import app from './app.js';
import env from './shared/config/env.js';
import { connect } from './shared/config/db.js';
import { registerHandlers as registerOrderHandlers } from './modules/order/order.events.js';
import { registerHandlers as registerInventoryHandlers } from './modules/inventory/inventory.events.js';
import { registerHandlers as registerPaymentHandlers } from './modules/payment/payment.events.js';
import { registerHandlers as registerNotificationHandlers } from './modules/notification/notification.events.js';

registerOrderHandlers();
registerInventoryHandlers();
registerPaymentHandlers();
registerNotificationHandlers();

await connect();
app.listen(env.PORT, () => console.log(`Server running on port ${env.PORT} [${env.NODE_ENV}]`));

import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'E-Commerce MERN API',
      version: '1.0.0',
      description: 'Modular monolith e-commerce backend — 7 DDD bounded contexts, event-driven saga, JWT auth.',
    },
    servers: [{ url: 'http://localhost:3000/api/v1', description: 'Local dev' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Paste the JWT token returned by POST /users/login',
        },
      },
      schemas: {
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { type: 'object' },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string' },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'Validation failed' },
            details: { type: 'object' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '665f1b2c3d4e5f6789012345' },
            name: { type: 'string', example: 'Alice' },
            email: { type: 'string', format: 'email', example: 'alice@example.com' },
            role: { type: 'string', enum: ['customer', 'admin'], example: 'customer' },
          },
        },
        Product: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            name: { type: 'string', example: 'Mechanical Keyboard' },
            description: { type: 'string' },
            price: { type: 'number', example: 129.99 },
            sku: { type: 'string', example: 'KB-001' },
            category: { type: 'string', example: 'Electronics' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        CartItem: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            name: { type: 'string' },
            price: { type: 'number' },
            quantity: { type: 'integer' },
          },
        },
        Cart: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
            totalAmount: { type: 'number' },
          },
        },
        ShippingAddress: {
          type: 'object',
          required: ['street', 'city', 'state', 'country', 'zip'],
          properties: {
            street: { type: 'string', example: '123 Main St' },
            city: { type: 'string', example: 'New York' },
            state: { type: 'string', example: 'NY' },
            country: { type: 'string', example: 'USA' },
            zip: { type: 'string', example: '10001' },
          },
        },
        Order: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            userId: { type: 'string' },
            items: { type: 'array', items: { $ref: '#/components/schemas/CartItem' } },
            totalAmount: { type: 'number' },
            status: {
              type: 'string',
              enum: ['PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
            },
            shippingAddress: { $ref: '#/components/schemas/ShippingAddress' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        Payment: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            orderId: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string', example: 'USD' },
            status: { type: 'string', enum: ['PENDING', 'AUTHORISED', 'FAILED', 'REFUNDED'] },
            idempotencyKey: { type: 'string' },
            providerRef: { type: 'string' },
          },
        },
        Inventory: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            productId: { type: 'string' },
            quantity: { type: 'integer', example: 100 },
            reserved: { type: 'integer', example: 5 },
            lowStockThreshold: { type: 'integer', example: 10 },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            type: { type: 'string', enum: ['EMAIL', 'SMS', 'PUSH'] },
            template: { type: 'string', example: 'order-confirmation' },
            status: { type: 'string', enum: ['PENDING', 'SENT', 'FAILED'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  apis: ['./src/modules/**/*.routes.js'],
};

export default swaggerJsdoc(options);

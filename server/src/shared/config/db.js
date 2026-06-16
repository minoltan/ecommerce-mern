const mongoose = require('mongoose');
const env = require('./env');

const connect = async () => {
  await mongoose.connect(env.MONGODB_URI);
  console.log(`MongoDB connected: ${env.MONGODB_URI}`);
};

const disconnect = async () => {
  await mongoose.disconnect();
};

module.exports = { connect, disconnect };

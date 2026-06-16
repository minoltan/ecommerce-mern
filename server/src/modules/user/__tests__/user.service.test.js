const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const userService = require('../user.service');
const User = require('../user.model');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
});

describe('register', () => {
  it('creates a user and returns id/name/email', async () => {
    const user = await userService.register({
      name: 'Alice',
      email: 'alice@test.com',
      password: 'password123',
    });
    expect(user.email).toBe('alice@test.com');
    expect(user.id).toBeDefined();
  });

  it('hashes the password before saving', async () => {
    await userService.register({ name: 'Alice', email: 'alice@test.com', password: 'password123' });
    const stored = await User.findOne({ email: 'alice@test.com' }).select('+password');
    expect(stored.password).not.toBe('password123');
  });

  it('throws 409 on duplicate email', async () => {
    await userService.register({ name: 'Alice', email: 'alice@test.com', password: 'password123' });
    await expect(
      userService.register({ name: 'Alice2', email: 'alice@test.com', password: 'password123' })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('login', () => {
  beforeEach(async () => {
    await userService.register({ name: 'Alice', email: 'alice@test.com', password: 'password123' });
  });

  it('returns a JWT token on valid credentials', async () => {
    const result = await userService.login({ email: 'alice@test.com', password: 'password123' });
    expect(result.token).toBeDefined();
    expect(result.user.email).toBe('alice@test.com');
  });

  it('throws 401 on wrong password', async () => {
    await expect(
      userService.login({ email: 'alice@test.com', password: 'wrongpassword' })
    ).rejects.toMatchObject({ status: 401 });
  });

  it('throws 401 on unknown email', async () => {
    await expect(
      userService.login({ email: 'nobody@test.com', password: 'password123' })
    ).rejects.toMatchObject({ status: 401 });
  });
});

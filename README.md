# PropChain - Blockchain-Powered Real Estate Platform

A modern, scalable backend API for real estate transactions built with NestJS and PostgreSQL.

## 🚀 Features

- **User Management** - Registration, authentication, and profile management
- **Property Listings** - Create, manage, and search property listings
- **Transaction Tracking** - Record and track real estate transactions
- **Document Management** - Store and manage property-related documents
- **Clean Architecture** - Modular, testable, and maintainable code structure
- **CI/CD Ready** - Automated testing and deployment pipeline

## 📋 Prerequisites

- Node.js >= 18.0.0
- PostgreSQL >= 14
- npm >= 8.0.0

## 🛠️ Installation

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Set up your database URL in .env file
```

## ⚙️ Configuration

The application uses environment variables for configuration. Copy `.env.example` to `.env` and adjust the values as needed.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment mode | development |
| `JWT_SECRET` | JWT signing secret | Required |
| `JWT_REFRESH_SECRET` | JWT refresh token secret | Required |
| `JWT_ACCESS_EXPIRES_IN` | Access token expiration | 15m |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token expiration | 7d |
| `BCRYPT_ROUNDS` | Password hashing rounds | 12 |
| `PASSWORD_HISTORY_LIMIT` | Password history limit | 5 |

## 🗄️ Database Setup

```bash
# Generate Prisma Client
npm run db:generate

# Run migrations
npm run migrate

# (Optional) Seed database
npm run db:seed
```

## 🏃 Running the App

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

## 🧪 Testing

```bash
# Unit tests
npm test

# Test coverage
npm run test:cov

# Watch mode
npm run test:watch
```

## 📁 Project Structure

```
src/
├── database/           # Database configuration and Prisma service
├── users/              # User management module
├── properties/         # Property listings module
├── app.module.ts       # Main application module
├── app.controller.ts   # App controller with health check
└── main.ts             # Application entry point

prisma/
├── schema.prisma       # Database schema
└── seed.ts             # Database seeding
```

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build the application |
| `npm run start:dev` | Start in development mode with watch |
| `npm run start:prod` | Start in production mode |
| `npm run lint` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |
| `npm test` | Run tests |
| `npm run test:cov` | Run tests with coverage |
| `npm run migrate` | Run database migrations |
| `npm run migrate:deploy` | Deploy migrations to production |
| `npm run db:generate` | Generate Prisma Client |
| `npm run db:studio` | Open Prisma Studio |

## 📊 Database Schema

### Core Models

- **User** - Platform users (buyers, sellers, agents, admins)
- **Property** - Real estate listings with detailed information
- **Transaction** - Property transactions with blockchain integration
- **Document** - Property-related documents and files

## 🔐 Environment Variables

Create a `.env` file based on `.env.example`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/propchain
PORT=3000
JWT_SECRET=your-secret-key
```

## 🚢 Deployment

The CI/CD pipeline is configured in `.github/workflows/ci.yml`:

- **Develop branch** → Deploys to staging
- **Main branch** → Deploys to production

### Manual Deployment

```bash
# Build for production
npm run build

# Run migrations
npm run migrate:deploy

# Start application
npm run start:prod
```

## 📝 API Endpoints

### Health Check
- `GET /api/health` - Application health status

### Users
- `POST /api/users` - Create user
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Properties
- `POST /api/properties` - Create property
- `GET /api/properties` - List all properties
- `GET /api/properties/:id` - Get property by ID
- `PUT /api/properties/:id` - Update property
- `DELETE /api/properties/:id` - Delete property

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 👥 Support

For support, email support@propchain.com or join our Slack channel.

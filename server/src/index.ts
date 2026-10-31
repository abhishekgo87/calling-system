import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './db';
import configRoutes from './routes/config';
import accountRoutes from './routes/account';
import callsRoutes from './routes/calls';
import recordsRoutes from './routes/records';
import bridgeRoutes from './routes/bridge';
import capacityRoutes from './routes/capacity';

const app = express();

// Security middleware
app.use(helmet());
app.use(express.json());

// Routes
app.use('/api/config', configRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/calls', callsRoutes);
app.use('/api/records', recordsRoutes);
app.use('/api/bridge', bridgeRoutes);
app.use('/api/capacity', capacityRoutes);

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', mock: config.OMIXO_MOCK, timestamp: new Date().toISOString() });
});

// Central error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error Handler]', err);
  res.status(500).json({
    ok: false,
    error: 'server_error',
    message: 'An unexpected internal server error occurred.',
  });
});

async function bootstrap() {
  try {
    await connectDatabase();

    app.listen(config.PORT, () => {
      console.log(`\n==================================================`);
      console.log(`🚀 Omixo Call Test Server running on port ${config.PORT}`);
      console.log(`📡 Omixo Base URL: ${config.OMIXO_BASE_URL}`);
      console.log(`📱 Allowed Numbers: ${config.ALLOWED_NUMBERS.join(', ')}`);

      if (config.OMIXO_MOCK) {
        console.log(`\n**************************************************`);
        console.log(`⚠️  WARNING: MOCK MODE IS ACTIVE (OMIXO_MOCK=true)`);
        console.log(`⚠️  Calls are simulated in-memory and will NOT`);
        console.log(`⚠️  ring real phone numbers or incur wallet charges.`);
        console.log(`⚠️  To use the live API, set OMIXO_MOCK=false in server/.env.`);
        console.log(`**************************************************\n`);
      } else {
        console.log(`🔐 Live Omixo API mode enabled.`);
      }
      console.log(`==================================================\n`);
    });
  } catch (error) {
    console.error('Fatal error during server startup:', error);
    process.exit(1);
  }
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('\nShutting down server gracefully...');
  await disconnectDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down server gracefully...');
  await disconnectDatabase();
  process.exit(0);
});

bootstrap();

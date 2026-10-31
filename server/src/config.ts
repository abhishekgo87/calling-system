import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';
import { normalizePhone } from './utils/phone';

// Load .env from current directory or server directory with override: true
dotenv.config({ override: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env'), override: true });

const envSchema = z.object({
  OMIXO_API_KEY: z
    .string({
      required_error: 'OMIXO_API_KEY is required in server/.env',
    })
    .min(1, 'OMIXO_API_KEY cannot be empty'),
  OMIXO_BASE_URL: z
    .string()
    .url('OMIXO_BASE_URL must be a valid URL')
    .default('https://api.omixo.ai/api/v1'),
  ALLOWED_NUMBERS: z
    .string()
    .optional()
    .default('*')
    .transform((val) => {
      if (!val || val.trim() === '*' || val.includes('*')) {
        return ['*'];
      }
      return val
        .split(',')
        .map((num) => normalizePhone(num.trim()))
        .filter((num) => num.length === 10);
    }),
  MONGODB_URI: z
    .string()
    .default('mongodb://127.0.0.1:27017/omixo-test'),
  PORT: z
    .string()
    .optional()
    .default('4000')
    .transform((val) => parseInt(val, 10))
    .refine((val) => !isNaN(val) && val > 0 && val <= 65535, {
      message: 'PORT must be a valid port number (1-65535)',
    }),
  OMIXO_MOCK: z
    .string()
    .optional()
    .default('false')
    .transform((val) => val === 'true' || val === '1' || val === 'yes'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n❌ Server environment configuration validation failed:');
  for (const issue of parsed.error.issues) {
    const field = issue.path.join('.') || 'root';
    console.error(`   - [${field}]: ${issue.message}`);
  }
  console.error('\nPlease verify your server/.env file contains all required variables.\n');
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;

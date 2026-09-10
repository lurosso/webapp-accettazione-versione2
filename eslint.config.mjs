// ESLint 9 (flat config) con la guardia architetturale della Regola d'Oro (ARCHITECTURE.md §3, §7).
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/** Messaggio unico per gli import vietati: rimanda ai factory e al composition root. */
const MSG_IMPLEMENTAZIONI =
  'Import vietato: le implementazioni concrete (mock, real, in-memory, prisma) si usano solo ' +
  'tramite services/factory.ts, repositories/factory.ts e config/container.ts (ARCHITECTURE.md §3).';

const MSG_FACTORY =
  'Import vietato: i factory e il container si usano solo dal composition root (config/) e ' +
  'dallo strato Next.js lato server (src/app/**, src/instrumentation.ts, src/proxy.ts).';

/** Pattern delle implementazioni concrete, sia con alias "@/" sia con percorsi relativi. */
const IMPLEMENTAZIONI = [
  '@/services/mocks',
  '@/services/mocks/*',
  '@/services/real',
  '@/services/real/*',
  '@/repositories/in-memory',
  '@/repositories/in-memory/*',
  '@/repositories/prisma',
  '@/repositories/prisma/*',
  '**/services/mocks',
  '**/services/mocks/*',
  '**/services/real',
  '**/services/real/*',
  '**/repositories/in-memory',
  '**/repositories/in-memory/*',
  '**/repositories/prisma',
  '**/repositories/prisma/*',
];

const FACTORY_E_CONTAINER = [
  '@/services/factory',
  '@/repositories/factory',
  '@/config/container',
  '**/services/factory',
  '**/repositories/factory',
  '**/config/container',
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
  {
    // Strati che non devono conoscere le implementazioni concrete.
    files: [
      'src/app/**/*.{ts,tsx}',
      'src/modules/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/application/**/*.ts',
      'src/proxy.ts',
      'src/instrumentation.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: IMPLEMENTAZIONI, message: MSG_IMPLEMENTAZIONI }] },
      ],
    },
  },
  {
    // Il codice React condiviso (anche lato client) non può toccare factory e container:
    // riceve i dati dalle pagine/Route Handler in src/app.
    files: [
      'src/modules/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/application/**/*.ts',
      'src/domain/**/*.ts',
      'src/lib/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: IMPLEMENTAZIONI, message: MSG_IMPLEMENTAZIONI },
            { group: FACTORY_E_CONTAINER, message: MSG_FACTORY },
          ],
        },
      ],
    },
  },
  {
    // I test possono istanziare mock e repository in-memory direttamente.
    files: ['tests/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'node_modules/**',
    'next-env.d.ts',
  ]),
]);

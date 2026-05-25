import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
];

export default config;

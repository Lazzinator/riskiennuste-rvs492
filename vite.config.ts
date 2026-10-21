import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Suhteellinen polku, jotta sivu toimii sekä GitHub Pagesin alipolussa että omalla domainilla.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});

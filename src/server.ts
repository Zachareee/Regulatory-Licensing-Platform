import { createApp } from './api/app';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const { app } = createApp();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Regulatory & Licensing Platform API listening on port ${PORT}`);
});

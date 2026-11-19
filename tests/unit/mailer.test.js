jest.mock('axios', () => ({ post: jest.fn() }));

const axios = require('axios');
const config = require('../../src/config');
const { sendMail } = require('../../src/lib/mailer');

describe('application mailer', () => {
  const original = { ...config.mailgun };
  afterEach(() => { config.mailgun = { ...original }; jest.clearAllMocks(); });

  test('does not call Mailgun when credentials are not configured', async () => {
    config.mailgun = { ...original, enabled: false };
    await expect(sendMail({ to: 'support@example.com', subject: 'x', text: 'y' })).resolves.toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('posts mail through the configured Mailgun domain', async () => {
    config.mailgun = { enabled: true, apiKey: 'test-key', domain: 'snbdhost.com', from: 'SNBD HOST <postmaster@snbdhost.com>', baseUrl: 'https://api.mailgun.net/v3' };
    axios.post.mockResolvedValue({ status: 200 });
    await expect(sendMail({ to: 'support@example.com', subject: 'Test', text: 'Hello', replyTo: 'user@example.com' })).resolves.toBe(true);
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/snbdhost.com/messages'), expect.any(URLSearchParams), expect.objectContaining({ auth: { username: 'api', password: 'test-key' } }));
  });
});

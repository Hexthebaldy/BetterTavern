# Privacy Policy

Effective date: October 23, 2026

This policy explains what information BetterTavern (the "Service", run by an individual developer, "we") collects, how it's used, who it goes to, how long it's kept, and what you can do about it.

## 1. What we collect

**Account information**: your email address, nickname, and the interface language you signed up with. Your password is stored only as a one-way hash (Argon2); we can't see it.

**What you create**: stories and the text of every part, character cards, scenarios, Workbench drafts and conversations, images you upload or generate, and the web pages and notes the agent read and took while researching.

**API keys you enter**: keys for model, search, page-reading and image services. They are encrypted with a master key on the server, and the app only ever shows their last four characters.

**Credit records**: when you use the official model, we record which model each call used, how many tokens, and how many credits it cost, but not the content. So that each email address only gets the trial allowance once, we also keep a one-way hash of your email address.

**Sign-in information**: the server issues sign-in tokens so you stay signed in. On the web, the browser keeps a single cookie used to renew your sign-in (HttpOnly, so page scripts can't read it). We use no advertising or analytics cookies.

**Logs**: to fix problems and prevent abuse, the server records the time, address, result and duration of requests. Application logs refer to your account by an irreversible code, and never record story text or API keys. The reverse proxy's access logs record IP addresses and are kept for about two weeks.

We don't collect your real name, phone number, location or contacts, and we use no third-party analytics or advertising tools.

## 2. How we use it

- To provide the Service: storing your content and calling your connected services when you ask;
- To work out credits: taking credits for official-model usage and estimating how many more turns you have;
- To check content: before a character card is saved to your library, an AI checks it for sexual content that breaks the [Content Rules](/rules); the result is only used to decide whether it can be saved;
- To send necessary emails: sign-up verification codes and password reset codes;
- For security and abuse prevention: rate limits, spotting unusual sign-ins and attacks;
- To fix problems: when something goes wrong, we get an alert with only the type and number of errors, never your content.

We don't sell your information, use your content for advertising, or use your content to train AI models. We don't look at your content except to handle your request for help, investigate a problem you reported, deal with a report of abuse, or comply with the law.

## 3. Who we share it with

Only with the providers needed to run the Service:

- **The official model**: when you use the official model to write stories or cards, and when a character card is checked before saving, your input, character cards and story context are sent to DeepSeek for processing. DeepSeek's servers are in China.
- **Your connected services**: when you write stories or cards, your input, character cards and story context go to the model provider you chose; search terms, the addresses of pages to read and image descriptions go to the matching service you connected. See their own privacy policies for how they handle it.
- **Servers and network**: the Service's server is in Singapore (Vultr). The website runs through Cloudflare's network for speed and protection, so Cloudflare processes your IP address and traffic.
- **Email**: verification emails are sent through Resend, which processes your email address and the message.

We may have to provide information to the authorities where the law requires it.

## 4. International transfers

The Service's server is in Singapore, and the providers listed above may process data in other countries or regions. In particular, when you use the official model your content is sent to DeepSeek in China for processing; if you'd rather it weren't, you can switch to a model you connect yourself in Settings. By using the Service you agree that your information may be stored and processed there.

## 5. How long we keep it

- Your account and what you create: until you delete them or your account;
- Deleting your account: your account and all of its data are deleted from the database immediately. Copies in backups (automatic server backups and database backups taken before upgrades) are removed as the backups rotate, usually within a few weeks;
- Credit records: until you delete your account;
- The email hash for trial allowances: kept after you delete your account, to stop the same email address claiming it again;
- Accounts not verified within 24 hours of signing up: deleted automatically;
- Verification codes: valid for 15 minutes, deleted once used or expired;
- Cached web pages the agent read: 7 days;
- Logs: rotated by size or time, usually kept for days to a few weeks.

## 6. Security

Data travels over HTTPS; API keys are stored encrypted; passwords are stored only as hashes. Still, no system is perfectly secure, so please use a password for the Service that you don't use anywhere else.

## 7. Your rights

- See and change: you can see your content in the app at any time and change your password;
- Delete: you can delete individual stories, character cards, scenarios and drafts, or your whole account in Settings › Account;
- Anything else (for example, a copy of your data): email support@bettertavern.com and we'll reply within a reasonable time.

## 8. Minors

The Service is only for people who are 18 or older. If we find that a minor has signed up, we will delete the account.

## 9. Changes to this policy

We may change this policy. When we do, we'll update the effective date on this page, and we'll give notice of major changes in advance on the website or by email.

## 10. Contact

Questions about this policy? Email support@bettertavern.com.

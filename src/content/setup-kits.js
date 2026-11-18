'use strict';

/**
 * Content for the Downloads & setup kits page and its three SNBD guides.
 * Every outside link was opened and checked before it was added; external cards say where they lead.
 * Text is bilingual: { en, bn }. The Bangla is an unreviewed translation.
 */

const CARDS = [
  // ---- featured: first things a customer wants to do after buying
  {
    id: 'email', featured: true, icon: 'mail', badge: 'guide', href: '/downloads/email-setup', needs: 'hosting',
    title: { en: 'Set up business email on my phone', bn: 'মোবাইলে অফিসের ইমেইল সেটআপ' },
    text: {
      en: 'Find your mailbox’s real settings in cPanel and add it to your Android phone or iPhone, step by step. Perfect for sales@yourbusiness.com.',
      bn: 'cPanel থেকে আপনার মেইলবক্সের আসল সেটিংস খুঁজে নিয়ে অ্যান্ড্রয়েড ফোন বা আইফোনে ধাপে ধাপে যোগ করুন। sales@yourbusiness.com-এর মতো ইমেইলের জন্য উপযুক্ত।',
    },
    button: { en: 'Open email setup guide', bn: 'ইমেইল সেটআপ গাইড খুলুন' },
    personal: { app: 'Email_Accounts', label: { en: 'Open my Email Accounts', bn: 'আমার ইমেইল অ্যাকাউন্টস খুলুন' } },
  },
  {
    id: 'wordpress', featured: true, icon: 'globe', badge: 'official', href: 'https://bn.wordpress.org/download/', host: 'bn.wordpress.org',
    title: { en: 'Download WordPress in Bangla', bn: 'বাংলা ওয়ার্ডপ্রেস ডাউনলোড' },
    text: {
      en: 'The official Bengali WordPress download, with installation resources. For web hosting customers launching a site in Bangla.',
      bn: 'অফিশিয়াল বাংলা ওয়ার্ডপ্রেস ডাউনলোড ও ইনস্টলেশনের তথ্য। বাংলায় ওয়েবসাইট চালু করতে চাওয়া ওয়েব হোস্টিং গ্রাহকদের জন্য।',
    },
    button: { en: 'Get WordPress বাংলা', bn: 'WordPress বাংলা নামান' },
  },
  {
    id: 'domain', featured: true, icon: 'plug', badge: 'guide', href: '/downloads/domain-connection', needs: 'hosting',
    title: { en: 'My domain connection sheet', bn: 'আমার ডোমেইন কানেক্ট করার তথ্য' },
    text: {
      en: 'A one-page sheet with your domain, nameservers and DNS records for your hosting. Copy any value, or send everything to your developer from your phone.',
      bn: 'আপনার হোস্টিংয়ের জন্য ডোমেইন, নেমসার্ভার ও ডিএনএস রেকর্ডের এক পাতার তথ্য। যেকোনো মান কপি করুন, অথবা সবকিছু ফোন থেকেই আপনার ডেভেলপারকে পাঠান।',
    },
    button: { en: 'Open my connection sheet', bn: 'আমার কানেকশন শিট খুলুন' },
  },
  // ---- more
  {
    id: 'bkash', icon: 'receipt', badge: 'guide', href: '/downloads/bkash-invoice',
    title: { en: 'Pay an SNBD invoice with bKash and save the receipt', bn: 'বিকাশে বিল পরিশোধ ও রসিদ ডাউনলোড' },
    text: {
      en: 'A short visual guide: open an invoice, pay with bKash, see it marked Paid, and save your receipt.',
      bn: 'ছোট ছবি-সহ গাইড: ইনভয়েস খুলুন, বিকাশে পরিশোধ করুন, “Paid” দেখুন এবং রসিদ সংরক্ষণ করুন।',
    },
    button: { en: 'Open the bKash guide', bn: 'বিকাশ গাইড দেখুন' },
  },
  {
    id: 'backup', icon: 'archive', badge: 'official', href: 'https://docs.cpanel.net/cpanel/files/backup-wizard/', host: 'docs.cpanel.net', needs: 'hosting',
    title: { en: 'Download a website backup', bn: 'ওয়েবসাইটের ব্যাকআপ নিন' },
    text: {
      en: 'cPanel’s Backup Wizard walks you through downloading a copy of your website. If your plan includes it, you can open your own backups in one click.',
      bn: 'cPanel-এর ব্যাকআপ উইজার্ড ধাপে ধাপে আপনার ওয়েবসাইটের একটি কপি ডাউনলোড করতে সাহায্য করে। আপনার প্ল্যানে থাকলে এক ক্লিকে নিজের ব্যাকআপ খুলতে পারবেন।',
    },
    button: { en: 'Read the backup guide', bn: 'ব্যাকআপ গাইড পড়ুন' },
    personal: { app: 'Backups_Home', label: { en: 'Open my backups', bn: 'আমার ব্যাকআপ খুলুন' } },
  },
  {
    id: 'btcl', icon: 'shield', badge: 'official', href: 'https://bdia.btcl.com.bd/', host: 'bdia.btcl.com.bd',
    title: { en: 'Register a .bd or .বাংলা domain', bn: 'ডোমেইনের জন্য কী কী লাগবে' },
    text: {
      en: 'BTCL runs the official .bd and .বাংলা registry. Check what a registration needs, and contact BTCL if a registered domain is still not live.',
      bn: 'BTCL-ই অফিশিয়াল .bd ও .বাংলা রেজিস্ট্রি চালায়। রেজিস্ট্রেশনে কী লাগে দেখুন, আর নিবন্ধিত ডোমেইন চালু না হলে BTCL-এর সাথে যোগাযোগ করুন।',
    },
    note: { en: 'BTCL domain desk: domain@btcl.gov.bd · 16402', bn: 'BTCL ডোমেইন ডেস্ক: domain@btcl.gov.bd · 16402' },
    button: { en: 'Check BTCL requirements', bn: 'BTCL-এর শর্ত দেখুন' },
  },
  {
    id: 'winscp', icon: 'download', badge: 'official', href: 'https://winscp.net/eng/download.php', host: 'winscp.net', needs: 'hosting',
    title: { en: 'Upload website files from Windows', bn: 'উইন্ডোজ থেকে ওয়েবসাইটের ফাইল আপলোড' },
    text: {
      en: 'WinSCP is a free file-transfer tool. Download it from the official site, then connect with the details from your hosting plan.',
      bn: 'WinSCP একটি বিনামূল্যের ফাইল ট্রান্সফার টুল। অফিশিয়াল সাইট থেকে নামান, তারপর আপনার হোস্টিং প্ল্যানের তথ্য দিয়ে কানেক্ট করুন।',
    },
    button: { en: 'Download WinSCP', bn: 'WinSCP নামান' },
  },
  {
    id: 'n8n', icon: 'bolt', badge: 'official', href: 'https://n8n.io/workflows/11643-manage-contact-form-submissions-with-google-sheets-slack-alerts-and-gmail-replies/', host: 'n8n.io',
    title: { en: 'Send website leads to Google Sheets', bn: 'ওয়েবসাইটের লিড গুগল শিটে পাঠান' },
    text: {
      en: 'A ready-made n8n workflow: it saves contact-form submissions to Google Sheets, alerts a Slack channel and replies by Gmail.',
      bn: 'তৈরি করা একটি n8n ওয়ার্কফ্লো: কন্টাক্ট ফর্মের তথ্য Google Sheets-এ জমা করে, Slack চ্যানেলে জানায় এবং Gmail-এ উত্তর পাঠায়।',
    },
    button: { en: 'Get the n8n workflow', bn: 'n8n ওয়ার্কফ্লো নিন' },
  },
];

/** Step-by-step guide: Business email on Android and iPhone. */
const EMAIL_GUIDE = {
  title: { en: 'Business email on Android and iPhone', bn: 'অ্যান্ড্রয়েড ও আইফোনে অফিসের ইমেইল সেটআপ' },
  intro: {
    en: 'Add a mailbox you created in cPanel, such as sales@yourbusiness.com, to your phone. It takes about five minutes.',
    bn: 'cPanel-এ খোলা মেইলবক্স, যেমন sales@yourbusiness.com, আপনার ফোনে যোগ করুন। সময় লাগবে প্রায় পাঁচ মিনিট।',
  },
  need: {
    en: ['A mailbox created in cPanel (Email → Email Accounts → Create)', 'The mailbox password', 'Your phone, connected to the internet'],
    bn: ['cPanel-এ খোলা একটি মেইলবক্স (Email → Email Accounts → Create)', 'মেইলবক্সের পাসওয়ার্ড', 'ইন্টারনেট-সংযুক্ত আপনার ফোন'],
  },
  steps: [
    {
      title: { en: 'Find your mailbox settings', bn: 'মেইলবক্সের সেটিংস খুঁজে নিন' },
      body: {
        en: ['Open cPanel and go to Email → Email Accounts.', 'Next to your mailbox, press Connect Devices.', 'Keep this screen open. It lists your username, the incoming and outgoing server names and the ports. Use the Secure SSL/TLS settings (recommended).'],
        bn: ['cPanel খুলে Email → Email Accounts-এ যান।', 'আপনার মেইলবক্সের পাশে Connect Devices চাপুন।', 'এই স্ক্রিন খোলা রাখুন। এখানে ইউজারনেম, ইনকামিং ও আউটগোয়িং সার্ভারের নাম এবং পোর্ট দেওয়া আছে। Secure SSL/TLS settings (প্রস্তাবিত) ব্যবহার করুন।'],
      },
    },
    {
      title: { en: 'Android', bn: 'অ্যান্ড্রয়েড' },
      body: {
        en: ['Open the Gmail app, tap your profile picture, then Add another account → Other.', 'Enter your full email address and choose Personal (IMAP).', 'Enter the password, then copy the incoming server from Connect Devices.', 'For outgoing mail, enter the outgoing server and your full email address as the username.', 'Finish the steps and allow syncing.'],
        bn: ['Gmail অ্যাপ খুলে প্রোফাইল ছবিতে চাপুন, তারপর Add another account → Other বেছে নিন।', 'সম্পূর্ণ ইমেইল ঠিকানা লিখুন এবং Personal (IMAP) বেছে নিন।', 'পাসওয়ার্ড দিন, তারপর Connect Devices থেকে ইনকামিং সার্ভার কপি করে বসান।', 'আউটগোয়িং মেইলের জন্য আউটগোয়িং সার্ভার দিন এবং ইউজারনেম হিসেবে সম্পূর্ণ ইমেইল ঠিকানা লিখুন।', 'ধাপগুলো শেষ করে সিঙ্ক চালু করুন।'],
      },
    },
    {
      title: { en: 'iPhone', bn: 'আইফোন' },
      body: {
        en: ['Easiest: in Connect Devices, look under Mail Client Automatic Configuration Scripts. If iOS is listed, open it on your iPhone and install the profile.', 'Or add it by hand: Settings → Mail → Accounts → Add Account → Other → Add Mail Account.', 'Enter your name, full email address and password, then choose IMAP and fill in the server names from Connect Devices.'],
        bn: ['সহজ উপায়: Connect Devices-এ Mail Client Automatic Configuration Scripts অংশ দেখুন। iOS থাকলে আইফোনে সেটি খুলে প্রোফাইল ইনস্টল করুন।', 'অথবা হাতে যোগ করুন: Settings → Mail → Accounts → Add Account → Other → Add Mail Account।', 'নাম, সম্পূর্ণ ইমেইল ঠিকানা ও পাসওয়ার্ড দিন, তারপর IMAP বেছে নিয়ে Connect Devices থেকে সার্ভারের নামগুলো বসান।'],
      },
    },
    {
      title: { en: 'Send a test email', bn: 'একটি টেস্ট ইমেইল পাঠান' },
      body: {
        en: ['Send an email from your new account to another address, such as your Gmail.', 'Reply to it, and check that the reply arrives on your phone.'],
        bn: ['নতুন অ্যাকাউন্ট থেকে অন্য কোনো ঠিকানায়, যেমন আপনার Gmail-এ, একটি ইমেইল পাঠান।', 'সেটির উত্তর দিন এবং দেখুন উত্তরটি আপনার ফোনে এসেছে কি না।'],
      },
    },
  ],
  help: {
    title: { en: 'If it does not work', bn: 'কাজ না করলে' },
    items: {
      en: ['The username is your full email address, not just the part before the @.', 'cPanel’s usual secure ports are 993 (IMAP), 995 (POP3) and 465 (SMTP). Always prefer the values shown in Connect Devices.', 'Check the password by signing in to webmail from cPanel.', 'Still stuck? Open a support ticket and tell us the mailbox name. Never send your password.'],
      bn: ['ইউজারনেম হলো সম্পূর্ণ ইমেইল ঠিকানা, শুধু @-এর আগের অংশ নয়।', 'cPanel-এর স্বাভাবিক সুরক্ষিত পোর্ট: 993 (IMAP), 995 (POP3) ও 465 (SMTP)। সবসময় Connect Devices-এ দেখানো মানকেই প্রাধান্য দিন।', 'cPanel থেকে ওয়েবমেইলে ঢুকে পাসওয়ার্ড যাচাই করুন।', 'তবুও না হলে সাপোর্ট টিকেট খুলুন এবং মেইলবক্সের নাম জানান। কখনো পাসওয়ার্ড পাঠাবেন না।'],
    },
  },
  docs: { href: 'https://docs.cpanel.net/cpanel/email/email-accounts/', label: { en: 'cPanel’s own Email Accounts guide', bn: 'cPanel-এর নিজস্ব Email Accounts গাইড' } },
};

/** Step-by-step guide: pay with bKash and save the receipt. */
const BKASH_GUIDE = {
  title: { en: 'Pay an SNBD invoice with bKash and save the receipt', bn: 'বিকাশে বিল পরিশোধ ও রসিদ ডাউনলোড' },
  intro: {
    en: 'Pay any unpaid SNBD HOST invoice from your phone or computer in a few taps, and keep a receipt.',
    bn: 'ফোন বা কম্পিউটার থেকে কয়েকটি ট্যাপেই যেকোনো অপরিশোধিত SNBD HOST ইনভয়েস পরিশোধ করুন এবং রসিদ রেখে দিন।',
  },
  steps: [
    { key: 'open', title: { en: 'Open the unpaid invoice', bn: 'অপরিশোধিত ইনভয়েস খুলুন' }, body: { en: 'In the menu choose Manage → Invoices, then open the invoice marked Unpaid.', bn: 'মেনু থেকে Manage → Invoices বেছে নিন, তারপর Unpaid চিহ্নিত ইনভয়েসটি খুলুন।' } },
    { key: 'pay', title: { en: 'Press Pay', bn: 'Pay চাপুন' }, body: { en: 'Press the red Pay button at the top of the invoice to open the payment page.', bn: 'ইনভয়েসের উপরের লাল Pay বোতামে চাপুন, পেমেন্ট পেজ খুলবে।' } },
    { key: 'choose', title: { en: 'Choose bKash', bn: 'বিকাশ বেছে নিন' }, body: { en: 'Select bKash, then press Continue to payment.', bn: 'বিকাশ নির্বাচন করে Continue to payment চাপুন।' } },
    { key: 'confirm', title: { en: 'Confirm on bKash', bn: 'বিকাশে নিশ্চিত করুন' }, body: { en: 'bKash opens its own secure page. Follow its screens to confirm the payment. SNBD HOST never sees your PIN.', bn: 'বিকাশ নিজস্ব সুরক্ষিত পেজ খুলবে। সেখানকার ধাপ অনুসরণ করে পেমেন্ট নিশ্চিত করুন। আপনার পিন SNBD HOST কখনো দেখে না।' } },
    { key: 'paid', title: { en: 'See it marked Paid', bn: '“Paid” দেখুন' }, body: { en: 'You return to SNBD HOST. The invoice now shows Paid, and your service is activated or renewed.', bn: 'আপনি SNBD HOST-এ ফিরে আসবেন। ইনভয়েসে এখন Paid দেখাবে এবং সার্ভিস চালু বা নবায়ন হবে।' } },
    { key: 'receipt', title: { en: 'Save your receipt', bn: 'রসিদ সংরক্ষণ করুন' }, body: { en: 'Open the paid invoice and press Print. Choose Save as PDF to keep a copy on your phone or computer.', bn: 'পরিশোধিত ইনভয়েস খুলে Print চাপুন। ফোন বা কম্পিউটারে কপি রাখতে Save as PDF বেছে নিন।' } },
  ],
  tip: { en: 'Paid but still showing Unpaid after a few minutes? Open a billing ticket with the invoice number and your bKash transaction ID.', bn: 'পরিশোধের কয়েক মিনিট পরেও Unpaid দেখাচ্ছে? ইনভয়েস নম্বর ও বিকাশ ট্রানজেকশন আইডি দিয়ে একটি বিলিং টিকেট খুলুন।' },
};

/** Labels of the domain connection sheet. */
const DOMAIN_SHEET = {
  title: { en: 'My domain connection sheet', bn: 'আমার ডোমেইন কানেক্ট করার তথ্য' },
  intro: {
    en: 'Everything you or your developer needs to point your domain at this hosting. Use one option, not both.',
    bn: 'এই হোস্টিংয়ে আপনার ডোমেইন যুক্ত করতে আপনার বা আপনার ডেভেলপারের যা যা লাগবে। দুটির মধ্যে একটি উপায় ব্যবহার করুন, দুটোই নয়।',
  },
  optionA: { en: 'Option A (recommended): change nameservers at your registrar', bn: 'উপায় ক (প্রস্তাবিত): রেজিস্ট্রারে নেমসার্ভার বদলান' },
  optionB: { en: 'Option B: keep your DNS elsewhere and add records', bn: 'উপায় খ: DNS অন্যত্র রেখে রেকর্ড যোগ করুন' },
  noteA: { en: 'This hands over website and email DNS to SNBD HOST.', bn: 'এতে ওয়েবসাইট ও ইমেইলের DNS SNBD HOST-এর হাতে যাবে।' },
  noteB: { en: 'Use this if your DNS is managed elsewhere, for example at Cloudflare.', bn: 'আপনার DNS অন্য কোথাও, যেমন Cloudflare-এ, থাকলে এটি ব্যবহার করুন।' },
  wait: { en: 'Changes can take from 1 to 24 hours to show everywhere. Until then your site may still look offline.', bn: 'পরিবর্তন সব জায়গায় দেখাতে ১ থেকে ২৪ ঘণ্টা লাগতে পারে। ততক্ষণ আপনার সাইট অফলাইন মনে হতে পারে।' },
  bdNote: { en: 'Registered a .bd domain and it is still not live? BTCL may be waiting for your documents. Contact BTCL: domain@btcl.gov.bd · 16402.', bn: '.bd ডোমেইন নিবন্ধন করেও চালু হয়নি? BTCL হয়তো আপনার কাগজপত্রের অপেক্ষায়। BTCL-এ যোগাযোগ করুন: domain@btcl.gov.bd · 16402।' },
};

// Nameservers SNBD tells customers to use (SNBD HOST knowledge-base article "How to Point Your Domain to SNBD HOST").
const DEFAULT_NAMESERVERS = ['ns1.snbdhost.com', 'ns2.snbdhost.com'];

module.exports = { CARDS, EMAIL_GUIDE, BKASH_GUIDE, DOMAIN_SHEET, DEFAULT_NAMESERVERS };

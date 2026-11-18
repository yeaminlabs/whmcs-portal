'use strict';

/**
 * Developer downloads and the "Trending on GitHub" picks for the Downloads page.
 * Every link was opened and checked; each card names the site it leads to. Text is bilingual
 * ({ en, bn }); the Bangla is an unreviewed translation.
 * The trending list is a dated snapshot (TRENDING_CHECKED), confirmed on github.com/trending that day.
 */

const CATEGORIES = [
  { id: 'containers', label: { en: 'Containers', bn: 'কনটেইনার' } },
  { id: 'os', label: { en: 'Operating systems', bn: 'অপারেটিং সিস্টেম' } },
  { id: 'automation', label: { en: 'Automation', bn: 'অটোমেশন' } },
  { id: 'updates', label: { en: 'Updates & security', bn: 'আপডেট ও নিরাপত্তা' } },
];

const DEV = [
  {
    id: 'n8n', cat: 'automation', icon: 'bolt', logo: 'n8n', href: 'https://github.com/n8n-io/n8n/releases', host: 'github.com/n8n-io',
    title: { en: 'n8n', bn: 'n8n' },
    text: { en: 'Official workflow automation releases for self-hosting.', bn: 'সেলফ-হোস্টিংয়ের জন্য n8n-এর অফিশিয়াল ওয়ার্কফ্লো অটোমেশন রিলিজ।' },
    tags: [{ en: 'Self-hosting', bn: 'সেলফ-হোস্টিং' }],
    button: { en: 'View n8n releases', bn: 'n8n রিলিজ দেখুন' },
    personal: { kind: 'n8n', label: { en: 'Open my n8n service', bn: 'আমার n8n সার্ভিস খুলুন' } },
  },
  {
    id: 'docker-desktop', cat: 'containers', icon: 'cpu', href: 'https://www.docker.com/products/docker-desktop/', host: 'docker.com',
    title: { en: 'Docker Desktop', bn: 'Docker Desktop' },
    text: { en: 'Installers for developing and testing containers on Windows, macOS, or Linux.', bn: 'উইন্ডোজ, ম্যাকওএস বা লিনাক্সে কনটেইনার তৈরি ও পরীক্ষার ইনস্টলার।' },
    tags: [{ en: 'Windows', bn: 'Windows' }, { en: 'macOS', bn: 'macOS' }, { en: 'Linux', bn: 'Linux' }],
    button: { en: 'Download Docker Desktop', bn: 'Docker Desktop নামান' },
  },
  {
    id: 'docker-engine', cat: 'containers', icon: 'server', href: 'https://docs.docker.com/engine/install/', host: 'docs.docker.com',
    title: { en: 'Docker Engine', bn: 'Docker Engine' },
    text: { en: 'Official installation packages and steps for Linux VPS customers, organized by distribution.', bn: 'লিনাক্স ভিপিএস গ্রাহকদের জন্য ডিস্ট্রিবিউশন অনুযায়ী অফিশিয়াল ইনস্টলেশন প্যাকেজ ও ধাপ।' },
    tags: [{ en: 'Linux VPS', bn: 'লিনাক্স ভিপিএস' }],
    tip: { en: 'Pick your Linux distribution on the page to see the right steps.', bn: 'সঠিক ধাপ দেখতে পেজে আপনার লিনাক্স ডিস্ট্রিবিউশন বেছে নিন।' },
    button: { en: 'Get Docker Engine', bn: 'Docker Engine নিন' },
  },
  {
    id: 'ubuntu-server', cat: 'os', icon: 'terminal', href: 'https://ubuntu.com/download/server', host: 'ubuntu.com',
    title: { en: 'Ubuntu Server LTS', bn: 'Ubuntu Server LTS' },
    text: { en: 'Official server ISO for a VM or VPS that supports custom images.', bn: 'কাস্টম ইমেজ সমর্থন করে এমন ভিএম বা ভিপিএসের জন্য অফিশিয়াল সার্ভার ISO।' },
    tags: [{ en: 'VM or custom-image VPS', bn: 'ভিএম বা কাস্টম-ইমেজ ভিপিএস' }],
    tip: { en: 'Choose the LTS release for servers.', bn: 'সার্ভারের জন্য LTS রিলিজ বেছে নিন।' },
    button: { en: 'Download Ubuntu Server', bn: 'Ubuntu Server নামান' },
  },
  {
    id: 'debian', cat: 'os', icon: 'terminal', href: 'https://www.debian.org/distrib/', host: 'debian.org',
    title: { en: 'Debian Stable', bn: 'Debian Stable' },
    text: { en: 'Official installer images, including a smaller network installer for a lighter first download.', bn: 'অফিশিয়াল ইনস্টলার ইমেজ, সাথে হালকা প্রথম ডাউনলোডের জন্য ছোট নেটওয়ার্ক ইনস্টলার।' },
    tags: [{ en: 'VM or custom-image VPS', bn: 'ভিএম বা কাস্টম-ইমেজ ভিপিএস' }],
    tip: { en: 'Verify the checksum after downloading.', bn: 'ডাউনলোডের পর চেকসাম যাচাই করুন।' },
    button: { en: 'Download Debian', bn: 'Debian নামান' },
    secondary: { href: 'https://www.debian.org/distrib/netinst', label: { en: 'Small network installer', bn: 'ছোট নেটওয়ার্ক ইনস্টলার' } },
  },
  {
    id: 'almalinux', cat: 'os', icon: 'terminal', href: 'https://almalinux.org/get-almalinux/', host: 'almalinux.org',
    title: { en: 'AlmaLinux', bn: 'AlmaLinux' },
    text: { en: 'Official ISO and cloud images for customers who need an Enterprise Linux distribution.', bn: 'এন্টারপ্রাইজ লিনাক্স ডিস্ট্রিবিউশন দরকার এমন গ্রাহকদের জন্য অফিশিয়াল ISO ও ক্লাউড ইমেজ।' },
    tags: [{ en: 'Enterprise Linux', bn: 'এন্টারপ্রাইজ লিনাক্স' }],
    tip: { en: 'Verify the checksum after downloading.', bn: 'ডাউনলোডের পর চেকসাম যাচাই করুন।' },
    button: { en: 'Download AlmaLinux', bn: 'AlmaLinux নামান' },
  },
  {
    id: 'ubuntu-security', cat: 'updates', icon: 'shield', href: 'https://ubuntu.com/security/notices', host: 'ubuntu.com',
    title: { en: 'Ubuntu security updates', bn: 'Ubuntu নিরাপত্তা আপডেট' },
    text: { en: 'Vendor notices that identify the affected Ubuntu releases and fixed package versions.', bn: 'কোন Ubuntu রিলিজ ঝুঁকিতে এবং কোন প্যাকেজ সংস্করণে সমাধান হয়েছে, তা জানানো ভেন্ডরের নোটিশ।' },
    tags: [{ en: 'Ubuntu servers', bn: 'Ubuntu সার্ভার' }],
    tip: { en: 'On your server, run lsb_release -a to see which release you have.', bn: 'কোন রিলিজ চালাচ্ছেন দেখতে সার্ভারে lsb_release -a চালান।' },
    button: { en: 'View security updates', bn: 'নিরাপত্তা আপডেট দেখুন' },
  },
  {
    id: 'wordpress-core', cat: 'updates', icon: 'globe', href: 'https://wordpress.org/download/releases/', host: 'wordpress.org',
    title: { en: 'WordPress core updates', bn: 'WordPress কোর আপডেট' },
    text: { en: 'Official release ZIPs and checksums for customers who need a manual update.', bn: 'ম্যানুয়ালি আপডেট করতে চাওয়া গ্রাহকদের জন্য অফিশিয়াল রিলিজ ZIP ও চেকসাম।' },
    tags: [{ en: 'WordPress sites', bn: 'WordPress সাইট' }],
    tip: { en: 'Back up your site before a manual update.', bn: 'ম্যানুয়াল আপডেটের আগে সাইটের ব্যাকআপ নিন।' },
    button: { en: 'View WordPress releases', bn: 'WordPress রিলিজ দেখুন' },
  },
];

/** Snapshot of the picks that were on https://github.com/trending on this date. */
const TRENDING_CHECKED = '2026-11-18';

const TRENDING = [
  {
    id: 'arcane', icon: 'cpu', href: 'https://github.com/getarcaneapp/arcane/releases', host: 'github.com/getarcaneapp',
    title: { en: 'Arcane', bn: 'Arcane' },
    text: { en: 'Browser-based Docker management for VPS customers running multiple containers.', bn: 'একাধিক কনটেইনার চালানো ভিপিএস গ্রাহকদের জন্য ব্রাউজার-ভিত্তিক Docker ম্যানেজমেন্ট।' },
    tags: [{ en: 'Docker', bn: 'Docker' }, { en: 'Linux VPS', bn: 'লিনাক্স ভিপিএস' }],
    button: { en: 'View Arcane releases', bn: 'Arcane রিলিজ দেখুন' },
  },
  {
    id: 'nvm', icon: 'terminal', href: 'https://github.com/nvm-sh/nvm/releases', host: 'github.com/nvm-sh',
    title: { en: 'nvm', bn: 'nvm' },
    text: { en: 'Install and switch between Node.js versions across projects.', bn: 'বিভিন্ন প্রজেক্টের জন্য Node.js-এর সংস্করণ ইনস্টল ও বদলানো।' },
    tags: [{ en: 'Node.js', bn: 'Node.js' }],
    button: { en: 'View nvm releases', bn: 'nvm রিলিজ দেখুন' },
  },
  {
    id: 'uv', icon: 'terminal', href: 'https://docs.astral.sh/uv/getting-started/installation/', host: 'docs.astral.sh',
    title: { en: 'uv', bn: 'uv' },
    text: { en: 'Manage Python projects, packages, and environments.', bn: 'Python প্রজেক্ট, প্যাকেজ ও এনভায়রনমেন্ট ম্যানেজ করুন।' },
    tags: [{ en: 'Python', bn: 'Python' }],
    button: { en: 'Download uv', bn: 'uv নামান' },
  },
  {
    id: 'appwrite', icon: 'database', href: 'https://github.com/appwrite/appwrite/releases', host: 'github.com/appwrite',
    title: { en: 'Appwrite', bn: 'Appwrite' },
    text: { en: 'A self-hostable app backend with authentication, databases, and storage.', bn: 'নিজে হোস্ট করার মতো অ্যাপ ব্যাকএন্ড, যাতে আছে অথেনটিকেশন, ডাটাবেস ও স্টোরেজ।' },
    tags: [{ en: 'Self-hosting', bn: 'সেলফ-হোস্টিং' }, { en: 'Backend', bn: 'ব্যাকএন্ড' }],
    button: { en: 'View Appwrite releases', bn: 'Appwrite রিলিজ দেখুন' },
  },
];

module.exports = { CATEGORIES, DEV, TRENDING, TRENDING_CHECKED };

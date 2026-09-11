import type { fr } from './fr'

export const en: Record<keyof typeof fr, string> = {
  'common.appName': 'AppForge',
  'common.tagline': 'Find an idea. Build it. Launch it. Monetise it. Without coding.',
  'common.loading': 'One moment…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.comingSoon': 'Coming soon',
  'common.error': 'Something went wrong.',
  'common.retry': 'Try again',

  'nav.dashboard': 'My project',
  'nav.ideas': 'My ideas',
  'nav.objective': 'My goal',
  'nav.logout': 'Sign out',
  'nav.login': 'Sign in',
  'nav.register': 'Create account',
  'nav.admin': 'Administration',

  'home.heroTitle': 'From your idea to your first sellable app.',
  'home.heroBody':
    "You don't need an idea, and you don't need to code. Tell us what you are aiming for and what you can do: we suggest what to build, we build it with you, and we guide you to your first customers.",
  'home.cta': 'Start with my goal',
  'home.step1Title': 'We find what to build',
  'home.step1Body':
    'You state your goal, your time and your skills. We propose costed ideas, with a suggested price and the matching number of customers.',
  'home.step2Title': 'We check before building',
  'home.step2Body':
    'Demand, competition, price, risks: the idea is analysed so you avoid working for nothing.',
  'home.step3Title': 'We build and publish',
  'home.step3Body': 'The app is created, tested, then published at an address you can share.',
  'home.notAnotherBuilder':
    "We don't just ask what you want to build. We help you work out what to build, why, and how to sell it.",

  'auth.registerTitle': 'Create your account',
  'auth.loginTitle': 'Sign in',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.name': 'Your first name',
  'auth.passwordHint': 'At least 10 characters, with a digit or a symbol.',
  'auth.noAccount': "Don't have an account yet?",
  'auth.hasAccount': 'Already have an account?',

  'dashboard.title': 'My apps',
  'dashboard.empty': "You don't have an app yet.",
  'dashboard.emptyBody': 'Start by describing what you would like to create.',
  'dashboard.create': 'Create an app',
  'dashboard.credits': 'Credits left',
  'dashboard.lastEdited': 'Edited',

  'status.DRAFT': 'Building',
  'status.TESTING': 'Testing',
  'status.READY': 'Ready to publish',
  'status.PUBLISHED': 'Published',

  'create.question': 'What would you like to create?',
  'create.describe': 'Describe your idea',
  'create.placeholder':
    'For example: an app that helps dog owners find walking routes near them.',
  'create.noIdea': "I don't have an idea yet",
  'create.submit': 'Analyse my idea',

  'progress.title': 'Your app',
  'progress.idea': 'Idea',
  'progress.design': 'Design',
  'progress.features': 'Features',
  'progress.tests': 'Tests',
  'progress.monetization': 'Monetisation',
  'progress.publication': 'Publication',

  'project.preview': 'Preview',
  'project.assistant': 'Edit with AI',
  'project.design': 'Design',
  'project.features': 'Features',
  'project.users': 'Users',
  'project.monetization': 'Monetisation',
  'project.tests': 'Tests',
  'project.publication': 'Publication',
  'project.settings': 'Settings',
  'project.versions': 'Versions',

  'editor.chatPlaceholder': 'Say what you want to change…',
  'editor.send': 'Send',
  'editor.thinking': 'The assistant is working…',
  'editor.devicePhone': 'Phone',
  'editor.deviceTablet': 'Tablet',
  'editor.deviceDesktop': 'Desktop',

  'versions.title': 'Version history',
  'versions.restore': 'Restore this version',
  'versions.restored': 'Version restored',

  'publish.title': 'Publish my app',
  'publish.action': 'Publish my app',
  'publish.published': 'Your app is online',
  'publish.readyPercent': 'Your app is {percent}% ready',

  'credits.insufficient':
    'You no longer have enough credits for this operation. Your credits renew every month.',
  'ai.disabled': 'The assistant is not configured on this installation. See the setup guide.',
}

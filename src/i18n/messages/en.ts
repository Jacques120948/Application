import type { fr } from './fr'

export const en: Record<keyof typeof fr, string> = {
  'common.appName': 'AppForge',
  'common.tagline': 'Describe your idea. AI builds your app.',
  'common.loading': 'One moment…',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.comingSoon': 'Coming soon',
  'common.error': 'Something went wrong.',
  'common.retry': 'Try again',

  'nav.dashboard': 'My apps',
  'nav.logout': 'Sign out',
  'nav.login': 'Sign in',
  'nav.register': 'Create account',
  'nav.admin': 'Administration',

  'home.heroTitle': 'Your idea becomes an app.',
  'home.heroBody':
    'Describe what you want to build, in plain words. The assistant builds the app, you test it, then you put it online.',
  'home.cta': 'Create my app',
  'home.step1Title': 'You describe',
  'home.step1Body': 'One sentence is enough. No technical skills needed.',
  'home.step2Title': 'The assistant builds',
  'home.step2Body': 'Structure, design, features and business model are proposed to you.',
  'home.step3Title': 'You publish',
  'home.step3Body': 'Your app goes online with an address you can share.',

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

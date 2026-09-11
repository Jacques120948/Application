import type { PrismaClient } from '@prisma/client'
import { DEMO_APPS } from '../src/server/demos/catalog'

/**
 * Installation des applications de démonstration.
 *
 * Elles sont montrées sur la page d'accueil et doivent être réellement ouvrables : ce sont
 * des projets publiés comme les autres, servis par le même moteur, à l'adresse
 * `/a/<slug>`. Rien n'est simulé.
 *
 * Deux précautions :
 *   - l'opération est idempotente : le script tourne à chaque mise en ligne ;
 *   - le compte propriétaire n'a pas de mot de passe utilisable. Personne ne s'y connecte,
 *     il n'existe que pour posséder les projets et satisfaire le cloisonnement.
 */

const DEMO_EMAIL = 'demonstrations@evoliia.app'

/** Hachage volontairement invalide : `verifyPassword` renvoie faux, la connexion échoue. */
const UNUSABLE_PASSWORD = 'compte-de-demonstration-sans-connexion'

/** Recettes d'exemple de Cooksy, pour que la liste publique ne soit pas vide. */
const COOKSY_RECIPES = [
  {
    titre: 'Tarte aux poireaux de ma grand-mère',
    categorie: 'Plat',
    temps: 55,
    etapes:
      "Émincez trois poireaux et faites-les fondre vingt minutes à feu doux avec une noix de beurre. Mélangez avec deux œufs et vingt centilitres de crème. Versez sur une pâte brisée et enfournez trente minutes à 180 °C.",
  },
  {
    titre: 'Velouté de courge au lait de coco',
    categorie: 'Entrée',
    temps: 35,
    etapes:
      "Faites revenir un oignon, ajoutez huit cents grammes de courge en cubes et couvrez d'eau. Laissez cuire vingt-cinq minutes, mixez, puis ajoutez vingt centilitres de lait de coco et une pincée de curry.",
  },
  {
    titre: 'Gâteau au yaourt, version sans balance',
    categorie: 'Dessert',
    temps: 40,
    etapes:
      "Un pot de yaourt, deux pots de sucre, trois pots de farine, un demi-pot d'huile, trois œufs, un sachet de levure. Mélangez, versez dans un moule, trente minutes à 180 °C.",
  },
  {
    titre: 'Citronnade à la menthe',
    categorie: 'Boisson',
    temps: 10,
    etapes:
      "Pressez quatre citrons, ajoutez un litre d'eau fraîche, deux cuillères de sucre et une dizaine de feuilles de menthe froissées. Laissez reposer une heure au frais avant de servir.",
  },
]

export async function seedDemoApps(prisma: PrismaClient): Promise<void> {
  const owner = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash: UNUSABLE_PASSWORD,
      name: 'Démonstrations Evoliia',
      locale: 'fr',
    },
    select: { id: true },
  })

  for (const demo of DEMO_APPS) {
    await prisma.$transaction(async (tx) => {
      // Les tables des projets sont soumises au Row Level Security : sans ce contexte,
      // l'insertion serait refusée. C'est la même mécanique que server/db/scope.ts.
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${owner.id}, true)`

      const spec = demo.spec as unknown as object
      const project = await tx.project.upsert({
        where: { slug: demo.slug },
        update: {
          name: demo.spec.name,
          draftSpec: spec,
          status: 'PUBLISHED',
          idea: demo.summary,
          deletedAt: null,
        },
        create: {
          ownerId: owner.id,
          name: demo.spec.name,
          slug: demo.slug,
          draftSpec: spec,
          status: 'PUBLISHED',
          locale: 'fr',
          idea: demo.summary,
        },
        select: { id: true },
      })

      const version = await tx.projectVersion.upsert({
        where: { projectId_number: { projectId: project.id, number: 1 } },
        update: { spec, label: 'Version de démonstration' },
        create: {
          projectId: project.id,
          number: 1,
          label: 'Version de démonstration',
          spec,
          source: 'AI',
        },
        select: { id: true },
      })

      await tx.project.update({
        where: { id: project.id },
        data: { publishedVersionId: version.id, publishedAt: new Date() },
      })

      if (demo.slug === 'cooksy') {
        const existing = await tx.appRecord.count({
          where: { projectId: project.id, modelId: 'recette' },
        })
        if (existing === 0) {
          await tx.appRecord.createMany({
            data: COOKSY_RECIPES.map((recipe) => ({
              projectId: project.id,
              modelId: 'recette',
              data: recipe,
            })),
          })
        }
      }
    })
  }

  console.log(`Démonstrations publiées : ${DEMO_APPS.map((demo) => demo.slug).join(', ')}`)
}

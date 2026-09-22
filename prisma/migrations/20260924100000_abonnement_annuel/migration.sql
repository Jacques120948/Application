-- Le prix annuel d'une offre, et son tarif Stripe.
--
-- Une offre, deux façons de la payer. On aurait pu créer quatre offres annuelles à côté des
-- quatre mensuelles : la grille tarifaire en aurait compté huit, le back-office huit, et
-- changer un quota aurait demandé de le changer deux fois — jusqu'au jour où on l'aurait
-- oublié, et où l'offre annuelle aurait promis autre chose que la mensuelle sous le même
-- nom.
--
-- Zéro veut dire « pas d'offre annuelle pour cette offre-ci ». C'est la valeur de départ
-- partout : la remise est une décision commerciale, elle ne s'allume pas parce que la
-- colonne existe. Rien n'est écrit dans le code — ni le prix, ni le taux de remise, qui se
-- déduit des deux prix réglés.
--
-- Le tarif Stripe annuel est gardé à part du mensuel : ce sont deux tarifs distincts chez
-- Stripe, et réutiliser une seule colonne ferait payer au mois quelqu'un qui a choisi
-- l'année, ou l'inverse. L'empreinte dit pour quel montant, quelle monnaie et quelle
-- période le tarif a été créé ; elle porte aussi le mode, si bien qu'un tarif créé en test
-- se recrée de lui-même au premier paiement en production.
ALTER TABLE "Plan"
  ADD COLUMN "priceYearCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stripePriceIdYear" TEXT,
  ADD COLUMN "stripePriceFingerprintYear" TEXT;

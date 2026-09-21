-- D'où vient le pays ciblé par ce plan.
--
-- Une colonne pour une phrase à l'écran, et elle vaut la migration. Le marché venait des
-- impressions : une boutique suisse s'est donc vu proposer une campagne ciblant l'Italie,
-- parce que ses pages italiennes reçoivent plus d'affichages que ses pages françaises. Le
-- pays d'où viennent les curieux n'est pas celui où l'on vend — et vendre depuis la Suisse
-- vers l'Italie veut dire des frais de douane sur chaque colis.
--
-- Le profil publicitaire prime désormais, les chiffres ne servent que de repli. Mais une
-- personne qui lit « Suisse » sur son plan doit pouvoir savoir si c'est parce qu'elle l'a
-- déclaré, ou parce qu'Evoliia l'a déduit — dans le second cas, c'est une supposition, et
-- une supposition se vérifie.

ALTER TABLE "AdsPlanCampagne"
  -- profil | chiffres
  ADD COLUMN "marcheSource" TEXT NOT NULL DEFAULT '';

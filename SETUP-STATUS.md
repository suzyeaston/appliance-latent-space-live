# Public launch status
Prepared September 26, 2026 from uploaded archive commit c865a7185fb80a8a92b13886589067456a854315.

The uploaded main snapshot contains a playable browser prototype. Earlier documents referenced a feature branch; this ZIP alone cannot prove remote branch/merge state.
The connected GitHub app exposed suzyeastonca but could not access the private appliance-latent-space repository.

Suzy requested a new public repository and a Downloads-folder Mac launch script. The chosen new remote is suzyeaston/appliance-latent-space-live.
The public script copies only the packaged source snapshot, creates fresh history, tests/builds, and publishes through the user's local GitHub CLI login.
This file does not establish remote creation or deployment; those happen when the script is run successfully.
The private remote, local existing checkouts and suzyeastonca are untouched.

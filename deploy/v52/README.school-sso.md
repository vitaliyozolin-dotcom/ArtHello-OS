# ArtHello OS → School diary identity boundary

- ArtHello OS authenticates employees and remains the authority for staff roles and system grants.
- The School diary receives a 60-second, one-time authorization code bound to a PKCE challenge.
- The callback audience is fixed to the configured School origin; callers cannot supply a redirect URI.
- The diary creates only its own technical session after reconciling the signed central identity.
- Parents and students do not use this route and never enter the ArtHello OS interface.
- Their direct School login uses a separate passwordless challenge delivered to the contact approved by the school.

# Microsoft Store Submission

These notes cover the Microsoft Store AppX/MSIX submission path for VispNote.

## Build Artifact

Build both Store package formats:

```sh
npm run build:win:store
```

This runs the AppX and MSIX package builds. You can also run them separately:

```sh
npm run build:win:appx
npm run build:win:msix
```

Submit the package artifact from `dist/`, for example:

```text
VispNote-0.1.13-store-x64.appx
VispNote-0.1.13-store-x64.msix
```

Do not submit a `portable` build to Partner Center.

## Signing

Policy 10.2.9 requires the installer binary and all included PE files to be signed with a code-signing certificate that chains to a CA in the Microsoft Trusted Root Program.

For a PFX certificate, set these before running the Store build on Windows:

```sh
set WIN_CSC_LINK=C:\path\to\certificate.pfx
set WIN_CSC_KEY_PASSWORD=your-certificate-password
npm run build:win:store
```

For GitHub Actions, store those values as repository secrets named `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`. `WIN_CSC_LINK` can be either a secure URL or a base64-encoded PFX.

The Store build uses `-c.forceCodeSigning=true`, so it fails if signing is not configured. That prevents accidentally submitting an unsigned package.

If Partner Center requires a specific package identity, pass the assigned values when building:

```sh
npm run build:win:appx -- -c.appx.identityName=Publisher.VispNote -c.appx.publisher="CN=00000000-0000-0000-0000-000000000000"
npm run build:win:msix -- -c.appx.identityName=Publisher.VispNote -c.appx.publisher="CN=00000000-0000-0000-0000-000000000000"
```

## Partner Center Checklist

- Upload the `.appx` or `.msix` package from `dist/`.
- Use the package identity and publisher from Partner Center.
- Keep the uploaded package immutable after submission.
- Use a new package version for every updated binary.

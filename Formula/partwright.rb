require "language/node"

# Homebrew formula for the `partwright` headless CLI.
#
# STATUS: tap-ready SKELETON, not yet published. The repo is set up so a future
# `brew tap` + `brew install partwright` is a one-step change — fill in `url` and
# `sha256` from a tagged release tarball and move this file into a tap repo
# (e.g. homebrew-partwright/Formula/). Nothing here is distributed today.
#
# Local install without a tap (works now):
#   npm ci && npm link        # exposes `partwright` on PATH
#   # or run ad hoc:  node bin/partwright.mjs --help
class Partwright < Formula
  desc "Headless CLI to drive the Partwright CAD engine + app for AI agents"
  homepage "https://www.partwrightstudio.com"
  # TODO(release): point at a tagged tarball and fill in the checksum.
  url "https://github.com/kemper/partwright/archive/refs/tags/v0.0.0.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "LicenseRef-PolyForm-Noncommercial-1.0.0"
  version "0.0.0"

  depends_on "node"

  def install
    # Installs the package + its runtime `dependencies` (vite/playwright/sharp
    # were promoted out of devDependencies for exactly this) into libexec and
    # creates the `partwright` bin shim from package.json `bin`.
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      Phase 1 (`partwright preview` / `run`) works out of the box.

      Phase 2 (the headless-browser daemon — `iterate`, `render`, `call`,
      `methods`, `bake`) needs a Chromium build. Install it once:
        npx playwright install chromium
    EOS
  end

  test do
    assert_match "headless Partwright CLI", shell_output("#{bin}/partwright --help")
  end
end

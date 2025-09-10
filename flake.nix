{
  description = "Community";

  inputs = {
    flake-utils.url = "github:numtide/flake-utils";
    nixpkgs.url = "nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      if system == "aarch64-darwin" || system == "x86_64-darwin" || system == "x86_64-linux" then
      let
        pkgs = import nixpkgs {
          inherit system;
          # overlays = [ (final: prev: {
          #   # gooseSrc = final.fetchFromGitHub {
          #   #   owner = "block";
          #   #   repo  = "vscode-goose";
          #   #   rev   = "v0.1.21";
          #   #   sha256 = "sha256-JnQgrQObtWM0N3VBxSvgQnE/QRHkjEz6lVPpUolHmu8";
          #   # };

          #   gooseSrc = "./";

          #   vscode-goose-built = final.stdenv.mkDerivation {
          #     pname = "vscode-goose";
          #     version = "0.1.21";
          #     src = final.gooseSrc;

          #     nativeBuildInputs = [
          #       final.cacert
          #       final.nodejs_24
          #       final.vsce
          #       final.jq
          #       final.unzip # `vsce` creates a .vsix archive, but we need to unpack it.
          #     ];
              
          #     # A simple build script to handle everything manually.
          #     buildPhase = ''
          #       echo "Running custom build phase..."
          #       set -e -x
                
          #       # Fix for the npm cache directory issue.
          #       export NPM_CONFIG_CACHE="$(pwd)/npm-cache"
          #       # Set the CA certificates for secure connections.
          #       export SSL_CERT_FILE="${final.cacert}/etc/ssl/certs/ca-bundle.crt"
                
          #       echo "Applying package.json patches..."
          #       # Patch the main package.json
          #       jq '. + {engines: {vscode: "^1.96.0"}}' package.json > package.json.tmp
          #       mv package.json.tmp package.json
                
          #       # Patch the webview-ui's package.json with all known dependencies
          #       cd webview-ui
          #       # , "vscode-extension-sync-utils": "latest"
          #       jq '. + { dependencies: { "shiki": "latest", "lucide-react": "latest", "@icons-pack/react-simple-icons": "latest", "react-markdown": "latest", "remark-gfm": "latest", "react-syntax-highlighter": "latest", "remark-rehype": "latest", "rehype-sanitize": "latest" } }' package.json > package.json.tmp
          #       mv package.json.tmp package.json
          #       cd ..
                
          #       # Install dependencies for the main project first
          #       echo "Installing main dependencies..."
          #       npm install
                
          #       # Install dependencies for the webview subdirectory
          #       echo "Installing webview dependencies..."
          #       cd webview-ui
          #       npm install
          #       cd ..
                
          #       echo "Compiling the main extension..."
          #       npm install
          #       npm run compile
                
          #       echo "Building the webview UI..."
          #       cd webview-ui
          #       npm run build
          #       cd ..
                
          #       echo "Packaging .vsix file..."
          #       mkdir -p $out/
          #       vsce package --out $out/vscode-goose.vsix
          #     '';

          #     installPhase = ''
          #       # echo "Installing .vsix file..."
          #       # mkdir -p $out/
          #       # cp *.vsix $out/vscode-goose.vsix
          #     '';
              
          #     meta = {
          #       description = "Goose VS Code extension (built)";
          #       homepage = "https://github.com/block/vscode-goose";
          #       license = final.lib.licenses.mit;
          #       maintainers = with final.lib.maintainers; [ "yourName" ];
          #       platforms = final.lib.platforms.all;
          #     };
          #   };
          # }) ];
        };
        darwinInputs = with pkgs; [
          libiconv
          darwin.apple_sdk.frameworks.Security
          darwin.apple_sdk.frameworks.SystemConfiguration
          darwin.apple_sdk.frameworks.CoreServices
        ];
      in
      {
        # packages.vscode-goose = pkgs.vscode-goose-built;
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            gemini-cli
            nodejs_24
            vsce
            pdfminer
            python312
            (python312.withPackages (ps: with ps; [
              pdfminer-six
              cryptography
              cffi
            ]))
            ripgrep
            # pkgs.vscode-goose-built
            zsh
            oh-my-zsh
          ];

          shell = pkgs.zsh;

          shellHook = ''
            # VSIX_PATH=$(nix path-info .#vscode-goose)/vscode-goose.vsix
            # Create a temporary directory for our custom zsh configuration
            ZDOTDIR_TMP=$(mktemp -d)

            # Write a .zshrc file that sources the user's real .zshrc, then sets the prompt.
            cat <<EOF > "$ZDOTDIR_TMP/.zshrc"
# Source user's config first, but don't fail if it has errors.
if [ -f "$HOME/.zshrc" ]; then
  export ZSH="${pkgs.oh-my-zsh}/share/oh-my-zsh";
  source "$HOME/.zshrc" || echo "nix-develop: [WARNING] Sourcing ~/.zshrc failed."
fi



# # Now, prepend to the prompt that the user's config set up.

PS1="[%~ ND] "
EOF

            # Write a .zlogout file for cleanup
            cat <<EOF > "$ZDOTDIR_TMP/.zlogout"
rm -rf "$ZDOTDIR_TMP"
EOF

            # Point ZDOTDIR to our temp dir so zsh uses our custom config
            export ZDOTDIR="$ZDOTDIR_TMP"

            echo
            echo "Hello from: nix develop shellHook"
            echo
            # echo "The .vsix file was built."
            echo
            # echo "To install the extension after building, run:"
            echo
            # echo "code --install-extension $VSIX_PATH "
            echo
            if [ "$SHELL" != "${pkgs.zsh}/bin/zsh" ]; then
              exec zsh
            fi
          '';
        };
      } else {}
    );
}

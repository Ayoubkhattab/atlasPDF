{ config, lib, pkgs, ... }:

let
  cfg = config.services.atlaspdf;
in
{
  options.services.atlaspdf = {
    enable = lib.mkEnableOption "AtlasPDF - Professional PDF Tools";

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.atlaspdf;
      defaultText = lib.literalExpression "pkgs.atlaspdf";
      description = "The AtlasPDF package to use.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Port to listen on.";
    };
  };

  config = lib.mkIf cfg.enable {
    nixpkgs.overlays = [
      (final: prev: {
        atlaspdf = final.callPackage ./package.nix { };
      })
    ];

    systemd.user.services.atlaspdf = {
      Unit = {
        Description = "AtlasPDF PDF Tools";
        After = [ "network.target" ];
      };

      Service = {
        ExecStart = "${cfg.package}/bin/atlaspdf";
        Restart = "on-failure";
        Environment = [
          "ATLASPDF_PORT=${toString cfg.port}"
        ];
      };

      Install = {
        WantedBy = [ "default.target" ];
      };
    };
  };
}

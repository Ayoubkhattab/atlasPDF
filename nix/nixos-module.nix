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

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Whether to open the firewall port.";
    };
  };

  config = lib.mkIf cfg.enable {
    nixpkgs.overlays = [
      (final: prev: {
        atlaspdf = final.callPackage ./package.nix { };
      })
    ];

    systemd.services.atlaspdf = {
      description = "AtlasPDF PDF Tools";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];

      environment = {
        ATLASPDF_PORT = toString cfg.port;
      };

      serviceConfig = {
        ExecStart = "${cfg.package}/bin/atlaspdf";
        Restart = "on-failure";
        DynamicUser = true;
        RuntimeDirectory = "atlaspdf";
        StateDirectory = "atlaspdf";

        # Hardening
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictSUIDSGID = true;
        MemoryDenyWriteExecute = false;
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}

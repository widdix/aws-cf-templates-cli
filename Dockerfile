FROM amazonlinux:2.0.20181114

RUN curl -o /usr/local/bin/widdix -L https://github.com/widdix/aws-cf-templates-cli/releases/download/v0.2.0/widdix-linux && chmod 755 /usr/local/bin/widdix

ENTRYPOINT ["/usr/local/bin/widdix"]

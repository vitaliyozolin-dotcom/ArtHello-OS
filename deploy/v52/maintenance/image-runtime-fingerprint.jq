.[0]
| {
    architecture: .Architecture,
    os: .Os,
    variant: (.Variant // null),
    created: .Created,
    config: {
      user: (.Config.User // ""),
      exposedPorts: (.Config.ExposedPorts // {}),
      env: (.Config.Env // []),
      entrypoint: (.Config.Entrypoint // []),
      cmd: (.Config.Cmd // []),
      volumes: (.Config.Volumes // {}),
      workingDir: (.Config.WorkingDir // ""),
      healthcheck: (.Config.Healthcheck // {}),
      labels: (.Config.Labels // {}),
      stopSignal: (.Config.StopSignal // ""),
      shell: (.Config.Shell // [])
    },
    rootfs: {
      type: .RootFS.Type,
      layers: (.RootFS.Layers // [])
    }
  }

# radinage

![Version: 0.1.0-rc1](https://img.shields.io/badge/Version-0.1.0--rc1-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 0.1.0-rc1](https://img.shields.io/badge/AppVersion-0.1.0--rc1-informational?style=flat-square)

A personal bank account tracking application

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| apps.api.adminPasswordSecret | object | `{"annotations":{},"create":true,"key":"password","labels":{},"name":""}` | Admin password secret |
| apps.api.adminPasswordSecret.annotations | object | `{}` | Extra annotations for the Secret |
| apps.api.adminPasswordSecret.create | bool | `true` | Create the secret (Helm generates a random value, kept across upgrades) |
| apps.api.adminPasswordSecret.key | string | `"password"` | Key inside the Secret |
| apps.api.adminPasswordSecret.labels | object | `{}` | Extra labels for the Secret |
| apps.api.adminPasswordSecret.name | string | `""` | Secret name (defaults to `<release>-admin-password`) |
| apps.api.adminUsername | string | `"admin"` | Admin account username |
| apps.api.affinity | object | `{}` | API affinity — override `global.affinity` |
| apps.api.autoscaling | object | `{}` | API autoscaling — override `global.autoscaling` |
| apps.api.containerSecurityContext | object | `{}` | API container security context — override `global.containerSecurityContext` |
| apps.api.corsOrigins | string | `""` | Allowed CORS origins (comma-separated) |
| apps.api.databaseSecret | object | `{"key":"url","name":"radinage-db"}` | Existing Secret holding the database connection string |
| apps.api.databaseSecret.key | string | `"url"` | Key inside the Secret |
| apps.api.databaseSecret.name | string | `"radinage-db"` | Secret name |
| apps.api.enabled | bool | `true` | Set to false to skip deploying the API |
| apps.api.extraEnv | list | `[]` | API additional environment variables |
| apps.api.extraVolumeMounts | list | `[]` | API additional volume mounts for the container |
| apps.api.extraVolumes | list | `[]` | API additional volumes to mount |
| apps.api.image | object | `{"pullPolicy":"","repository":"radinage-api","tag":""}` | API container image — override `global.image` |
| apps.api.image.pullPolicy | string | `""` | Image pull policy — override `global.image.pullPolicy` |
| apps.api.image.repository | string | `"radinage-api"` | Image repository |
| apps.api.image.tag | string | `""` | Image tag — override `global.image.tag` |
| apps.api.imagePullSecrets | list | `[]` | API image pull secrets — override `global.imagePullSecrets` |
| apps.api.jwtExpirationSecs | string | `"86400"` | JWT token expiration in seconds |
| apps.api.jwtSecret | object | `{"annotations":{},"create":true,"key":"secret","labels":{},"name":""}` | JWT signing key secret |
| apps.api.jwtSecret.annotations | object | `{}` | Extra annotations for the Secret |
| apps.api.jwtSecret.create | bool | `true` | Create the secret (Helm generates a random value, kept across upgrades) |
| apps.api.jwtSecret.key | string | `"secret"` | Key inside the Secret |
| apps.api.jwtSecret.labels | object | `{}` | Extra labels for the Secret |
| apps.api.jwtSecret.name | string | `""` | Secret name (defaults to `<release>-jwt`) |
| apps.api.logJson | bool | `false` | Emit logs in JSON format |
| apps.api.maxBudgetsPerUser | string | `"100"` | Maximum number of budgets per user |
| apps.api.nodeSelector | object | `{}` | API node selector — override `global.nodeSelector` |
| apps.api.podAnnotations | object | `{}` | API pod annotations — override `global.podAnnotations` |
| apps.api.podLabels | object | `{}` | API pod labels — override `global.podLabels` |
| apps.api.podSecurityContext | object | `{}` | API pod security context — override `global.podSecurityContext` |
| apps.api.port | int | `3000` | API container port |
| apps.api.probes | object | `{"liveness":{"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":10},"readiness":{"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":5}}` | API liveness and readiness probes |
| apps.api.probes.liveness | object | `{"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":10}` | Liveness probe configuration |
| apps.api.probes.readiness | object | `{"httpGet":{"path":"/api/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":5}` | Readiness probe configuration |
| apps.api.replicaCount | string | `""` | API replica count — override `global.replicaCount` |
| apps.api.resources | object | `{}` | API resource requests and limits — override `global.resources` |
| apps.api.revisionHistoryLimit | string | `""` | API revision history limit — override `global.revisionHistoryLimit` |
| apps.api.rootPath | string | `"api"` | Root path prefix for API routes |
| apps.api.service | object | `{}` | API service — override `global.service` |
| apps.api.serviceAccount | object | `{}` | API ServiceAccount — override `global.serviceAccount` |
| apps.api.tolerations | list | `[]` | API tolerations — override `global.tolerations` |
| apps.api.volumeMounts | list | `[]` | API volume mounts for the container |
| apps.api.volumes | list | `[]` | API volumes to mount |
| apps.api.webappUrl | string | `""` | Base URL of the web application (used for invitation links). Defaults to `<protocol>://<global.domain><ingress.apps.webapp.path>` |
| apps.mcp.affinity | object | `{}` | MCP affinity — override `global.affinity` |
| apps.mcp.apiUrl | string | `""` | Radinage API URL. Defaults to the cluster-internal service URL. |
| apps.mcp.autoscaling | object | `{}` | MCP autoscaling — override `global.autoscaling` |
| apps.mcp.containerSecurityContext | object | `{}` | MCP container security context — override `global.containerSecurityContext` |
| apps.mcp.enabled | bool | `true` | Set to false to skip deploying the MCP server |
| apps.mcp.extraEnv | list | `[]` | MCP additional environment variables |
| apps.mcp.extraVolumeMounts | list | `[]` | MCP additional volume mounts for the container |
| apps.mcp.extraVolumes | list | `[]` | MCP additional volumes to mount |
| apps.mcp.image | object | `{"pullPolicy":"","repository":"radinage-mcp","tag":""}` | MCP container image — override `global.image` |
| apps.mcp.image.pullPolicy | string | `""` | Image pull policy — override `global.image.pullPolicy` |
| apps.mcp.image.repository | string | `"radinage-mcp"` | Image repository |
| apps.mcp.image.tag | string | `""` | Image tag — override `global.image.tag` |
| apps.mcp.imagePullSecrets | list | `[]` | MCP image pull secrets — override `global.imagePullSecrets` |
| apps.mcp.nodeSelector | object | `{}` | MCP node selector — override `global.nodeSelector` |
| apps.mcp.podAnnotations | object | `{}` | MCP pod annotations — override `global.podAnnotations` |
| apps.mcp.podLabels | object | `{}` | MCP pod labels — override `global.podLabels` |
| apps.mcp.podSecurityContext | object | `{}` | MCP pod security context — override `global.podSecurityContext` |
| apps.mcp.port | int | `3001` | MCP container port |
| apps.mcp.probes | object | `{"liveness":{"httpGet":{"path":"/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":10},"readiness":{"httpGet":{"path":"/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":5}}` | MCP liveness and readiness probes |
| apps.mcp.probes.liveness | object | `{"httpGet":{"path":"/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":10}` | Liveness probe configuration |
| apps.mcp.probes.readiness | object | `{"httpGet":{"path":"/health","port":"http"},"initialDelaySeconds":5,"periodSeconds":5}` | Readiness probe configuration |
| apps.mcp.replicaCount | string | `""` | MCP replica count — override `global.replicaCount` |
| apps.mcp.resources | object | `{}` | MCP resource requests and limits — override `global.resources` |
| apps.mcp.revisionHistoryLimit | string | `""` | MCP revision history limit — override `global.revisionHistoryLimit` |
| apps.mcp.service | object | `{}` | MCP service — override `global.service` |
| apps.mcp.serviceAccount | object | `{}` | MCP ServiceAccount — override `global.serviceAccount` |
| apps.mcp.tolerations | list | `[]` | MCP tolerations — override `global.tolerations` |
| apps.mcp.volumeMounts | list | `[]` | MCP volume mounts for the container |
| apps.mcp.volumes | list | `[]` | MCP volumes to mount |
| apps.webapp.affinity | object | `{}` | Webapp affinity — override `global.affinity` |
| apps.webapp.apiHost | string | `""` | Upstream API host:port used by nginx proxy_pass. Defaults to the cluster-internal service: `<release>-api:<apps.api.port>`. |
| apps.webapp.autoscaling | object | `{}` | Webapp autoscaling — override `global.autoscaling` |
| apps.webapp.containerSecurityContext | object | `{}` | Webapp container security context — override `global.containerSecurityContext` |
| apps.webapp.enabled | bool | `true` | Set to false to skip deploying the webapp |
| apps.webapp.extraEnv | list | `[]` | Webapp additional environment variables |
| apps.webapp.extraVolumeMounts | list | `[]` | Webapp additional volume mounts for the container |
| apps.webapp.extraVolumes | list | `[]` | Webapp additional volumes to mount |
| apps.webapp.image | object | `{"pullPolicy":"","repository":"radinage-webapp","tag":""}` | Webapp container image — override `global.image` |
| apps.webapp.image.pullPolicy | string | `""` | Image pull policy — override `global.image.pullPolicy` |
| apps.webapp.image.repository | string | `"radinage-webapp"` | Image repository |
| apps.webapp.image.tag | string | `""` | Image tag — override `global.image.tag` |
| apps.webapp.imagePullSecrets | list | `[]` | Webapp image pull secrets — override `global.imagePullSecrets` |
| apps.webapp.nodeSelector | object | `{}` | Webapp node selector — override `global.nodeSelector` |
| apps.webapp.podAnnotations | object | `{}` | Webapp pod annotations — override `global.podAnnotations` |
| apps.webapp.podLabels | object | `{}` | Webapp pod labels — override `global.podLabels` |
| apps.webapp.podSecurityContext | object | `{}` | Webapp pod security context — override `global.podSecurityContext` |
| apps.webapp.port | int | `8080` | Webapp container port |
| apps.webapp.probes | object | `{"liveness":{"httpGet":{"path":"/","port":"http"},"initialDelaySeconds":5,"periodSeconds":10},"readiness":{"httpGet":{"path":"/","port":"http"},"initialDelaySeconds":5,"periodSeconds":5}}` | Webapp liveness and readiness probes |
| apps.webapp.probes.liveness | object | `{"httpGet":{"path":"/","port":"http"},"initialDelaySeconds":5,"periodSeconds":10}` | Liveness probe configuration |
| apps.webapp.probes.readiness | object | `{"httpGet":{"path":"/","port":"http"},"initialDelaySeconds":5,"periodSeconds":5}` | Readiness probe configuration |
| apps.webapp.replicaCount | string | `""` | Webapp replica count — override `global.replicaCount` |
| apps.webapp.resources | object | `{}` | Webapp resource requests and limits — override `global.resources` |
| apps.webapp.revisionHistoryLimit | string | `""` | Webapp revision history limit — override `global.revisionHistoryLimit` |
| apps.webapp.service | object | `{}` | Webapp service — override `global.service` |
| apps.webapp.serviceAccount | object | `{}` | Webapp ServiceAccount — override `global.serviceAccount` |
| apps.webapp.tolerations | list | `[]` | Webapp tolerations — override `global.tolerations` |
| apps.webapp.volumeMounts | list | `[{"mountPath":"/tmp","name":"tmp","subPath":"tmp"},{"mountPath":"/etc/nginx/conf.d","name":"nginx-conf-d"}]` | Webapp volume mounts for the container |
| apps.webapp.volumes | list | `[{"emptyDir":{},"name":"tmp"},{"emptyDir":{},"name":"nginx-conf-d"}]` | Webapp volumes to mount |
| global.affinity | object | `{}` | Affinity rules for pod scheduling |
| global.autoscaling | object | `{"enabled":false,"maxReplicas":3,"minReplicas":1,"targetCPUUtilizationPercentage":80}` | Horizontal Pod Autoscaler configuration |
| global.autoscaling.enabled | bool | `false` | Enable autoscaling |
| global.autoscaling.maxReplicas | int | `3` | Maximum number of replicas |
| global.autoscaling.minReplicas | int | `1` | Minimum number of replicas |
| global.autoscaling.targetCPUUtilizationPercentage | int | `80` | Target CPU utilization percentage |
| global.containerSecurityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}` | Container-level security context (restricted by default) |
| global.domain | string | `"radinage.example.com"` | Domain name used by the ingress and to derive URLs |
| global.image | object | `{"pullPolicy":"IfNotPresent","registry":"ghcr.io/leroyguillaume","tag":""}` | Container image defaults |
| global.image.pullPolicy | string | `"IfNotPresent"` | Image pull policy |
| global.image.registry | string | `"ghcr.io/leroyguillaume"` | Image registry |
| global.image.tag | string | `""` | Image tag — overrides the chart `appVersion` |
| global.imagePullSecrets | list | `[]` | Image pull secrets |
| global.logFilter | string | `"info"` | Log level filter shared across apps (e.g. info, debug, warn) |
| global.nodeSelector | object | `{}` | Node selector constraints |
| global.podAnnotations | object | `{}` | Annotations to add to pods |
| global.podLabels | object | `{}` | Labels to add to pods |
| global.podSecurityContext | object | `{"fsGroup":1000,"runAsGroup":1000,"runAsNonRoot":true,"runAsUser":1000,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod-level security context (restricted by default) |
| global.replicaCount | int | `1` | Number of replicas |
| global.resources | object | `{"limits":{"memory":"256Mi"},"requests":{"cpu":"100m","memory":"128Mi"}}` | Container resource requests and limits |
| global.revisionHistoryLimit | int | `10` | Number of old ReplicaSets to retain for rollback |
| global.service | object | `{"type":"ClusterIP"}` | Service configuration |
| global.service.type | string | `"ClusterIP"` | Kubernetes Service type |
| global.serviceAccount | object | `{"annotations":{},"automountServiceAccountToken":false,"create":true}` | ServiceAccount configuration |
| global.serviceAccount.annotations | object | `{}` | Annotations to add to the ServiceAccount |
| global.serviceAccount.automountServiceAccountToken | bool | `false` | Automount the ServiceAccount token |
| global.serviceAccount.create | bool | `true` | Create a ServiceAccount for each app |
| global.tolerations | list | `[]` | Tolerations for pod scheduling |
| ingress.annotations | object | `{}` | Annotations to add to the Ingress |
| ingress.apps.api.path | string | `"/api"` | API URL path |
| ingress.apps.api.pathType | string | `"Prefix"` | API path type (Prefix, Exact, ImplementationSpecific) |
| ingress.apps.mcp.path | string | `"/mcp"` | MCP URL path |
| ingress.apps.mcp.pathType | string | `"Prefix"` | MCP path type |
| ingress.apps.webapp.path | string | `"/"` | Webapp URL path |
| ingress.apps.webapp.pathType | string | `"Prefix"` | Webapp path type |
| ingress.apps.webapp.protocol | string | `"https"` | Protocol used to build the webapp URL (http or https) |
| ingress.className | string | `""` | Ingress class name |
| ingress.defaultBackend | string | `"webapp"` | Default backend app (must match a key in `apps`) |
| ingress.enabled | bool | `false` | Enable the Ingress resource |
| ingress.tls | list | `[]` | TLS configuration |

----------------------------------------------
Autogenerated from chart metadata using [helm-docs v1.14.2](https://github.com/norwoodj/helm-docs/releases/v1.14.2)

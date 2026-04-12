{{/*
Chart name truncated to 63 chars.
*/}}
{{- define "radinage.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name: <release>-<app>.
Usage: {{ include "radinage.fullname" (dict "appName" $name "root" $) }}
*/}}
{{- define "radinage.fullname" -}}
{{- printf "%s-%s" .root.Release.Name .appName | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Chart label value.
*/}}
{{- define "radinage.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels for a given app.
Usage: {{ include "radinage.labels" (dict "appName" $name "root" $) }}
*/}}
{{- define "radinage.labels" -}}
helm.sh/chart: {{ include "radinage.chart" .root }}
{{ include "radinage.selectorLabels" . }}
app.kubernetes.io/version: {{ .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end }}

{{/*
Selector labels for a given app.
Usage: {{ include "radinage.selectorLabels" (dict "appName" $name "root" $) }}
*/}}
{{- define "radinage.selectorLabels" -}}
app.kubernetes.io/name: {{ include "radinage.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .appName }}
{{- end }}

{{/*
ServiceAccount name for a given app.
Usage: {{ include "radinage.serviceAccountName" (dict "appName" $name "appValues" $app "root" $) }}
*/}}
{{- define "radinage.serviceAccountName" -}}
{{- $saCreate := .root.Values.global.serviceAccount.create -}}
{{- $appSA := dig "serviceAccount" "create" "" .appValues -}}
{{- if ne (toString $appSA) "" -}}
  {{- $saCreate = $appSA -}}
{{- end -}}
{{- if $saCreate -}}
  {{- include "radinage.fullname" . -}}
{{- else -}}
  {{- default "default" (dig "serviceAccount" "name" "" .appValues) -}}
{{- end -}}
{{- end }}

{{/*
ServiceAccount annotations (merged global + app-level).
Usage: {{ include "radinage.serviceAccountAnnotations" $ctx | nindent 2 }}
*/}}
{{- define "radinage.serviceAccountAnnotations" -}}
{{- $annotations := merge (default dict (dig "serviceAccount" "annotations" nil .appValues)) (default dict .root.Values.global.serviceAccount.annotations) }}
{{- with $annotations }}
annotations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
JWT Secret name. Defaults to <release>-jwt if not set.
Usage: {{ include "radinage.jwtSecretName" . }}
*/}}
{{- define "radinage.jwtSecretName" -}}
{{- $name := .Values.apps.api.jwtSecret.name -}}
{{- default (printf "%s-jwt" .Release.Name) $name -}}
{{- end }}

{{/*
Admin password Secret name. Defaults to <release>-admin-password if not set.
Usage: {{ include "radinage.adminPasswordSecretName" . }}
*/}}
{{- define "radinage.adminPasswordSecretName" -}}
{{- $name := .Values.apps.api.adminPasswordSecret.name -}}
{{- default (printf "%s-admin-password" .Release.Name) $name -}}
{{- end }}

{{/*
Radinage API URL for the MCP server.
Defaults to the cluster-internal service: http://<release>-api:<port>.
Usage: {{ include "radinage.apiUrl" . }}
*/}}
{{- define "radinage.apiUrl" -}}
{{- $url := .Values.apps.mcp.apiUrl -}}
{{- if $url -}}
  {{- $url -}}
{{- else -}}
  {{- $ctx := dict "appName" "api" "root" . -}}
  {{- printf "http://%s:%v" (include "radinage.fullname" $ctx) .Values.apps.api.port -}}
{{- end -}}
{{- end }}

{{/*
Webapp URL. Defaults to <protocol>://<global.domain><webapp ingress path>.
Usage: {{ include "radinage.webappUrl" . }}
*/}}
{{- define "radinage.webappUrl" -}}
{{- $url := .Values.apps.api.webappUrl -}}
{{- if $url -}}
  {{- $url -}}
{{- else -}}
  {{- $protocol := dig "apps" "webapp" "protocol" "https" .Values.ingress -}}
  {{- $domain := .Values.global.domain -}}
  {{- $path := dig "apps" "webapp" "path" "/" .Values.ingress | trimSuffix "/" -}}
  {{- printf "%s://%s%s" $protocol $domain $path -}}
{{- end -}}
{{- end }}

{{/*
Image string for a given app.
Usage: {{ include "radinage.image" (dict "appValues" $app "root" $) }}
*/}}
{{- define "radinage.image" -}}
{{- $registry := .root.Values.global.image.registry -}}
{{- $repo := .appValues.image.repository -}}
{{- $tag := default .root.Chart.AppVersion (default .root.Values.global.image.tag (dig "image" "tag" "" .appValues)) -}}
{{- printf "%s/%s:%s" $registry $repo $tag -}}
{{- end }}

{{/*
Pod metadata (annotations + labels) shared by all deployments.
Usage: {{ include "radinage.podMetadata" $ctx | nindent 6 }}
*/}}
{{- define "radinage.podMetadata" -}}
{{- $podAnnotations := merge (default dict .appValues.podAnnotations) (default dict .root.Values.global.podAnnotations) }}
{{- with $podAnnotations }}
annotations:
  {{- toYaml . | nindent 2 }}
{{- end }}
labels:
  {{- include "radinage.labels" . | nindent 2 }}
  {{- with (merge (default dict .appValues.podLabels) (default dict .root.Values.global.podLabels)) }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
{{- end }}

{{/*
Pod spec (imagePullSecrets, serviceAccount, securityContext) shared by all deployments.
Usage: {{ include "radinage.podSpec" $ctx | nindent 6 }}
*/}}
{{- define "radinage.podSpec" -}}
{{- with (default .root.Values.global.imagePullSecrets (dig "imagePullSecrets" nil .appValues)) }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
serviceAccountName: {{ include "radinage.serviceAccountName" . }}
automountServiceAccountToken: {{ default .root.Values.global.serviceAccount.automountServiceAccountToken (dig "serviceAccount" "automountServiceAccountToken" false .appValues) }}
securityContext:
  {{- $podSC := dig "podSecurityContext" nil .appValues }}
  {{- toYaml (default .root.Values.global.podSecurityContext $podSC) | nindent 2 }}
{{- end }}

{{/*
Container spec (image, securityContext, ports, probes, resources) shared by all deployments.
Does NOT include env or volumeMounts — those are app-specific.
Usage: {{ include "radinage.containerSpec" $ctx | nindent 10 }}
*/}}
{{- define "radinage.containerSpec" -}}
image: {{ include "radinage.image" . }}
imagePullPolicy: {{ default .root.Values.global.image.pullPolicy (dig "image" "pullPolicy" "" .appValues) }}
securityContext:
  {{- $csc := dig "containerSecurityContext" nil .appValues }}
  {{- toYaml (default .root.Values.global.containerSecurityContext $csc) | nindent 2 }}
ports:
  - name: http
    containerPort: {{ .appValues.port }}
    protocol: TCP
{{- with .appValues.probes }}
{{- with .liveness }}
livenessProbe:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .readiness }}
readinessProbe:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
resources:
  {{- $res := dig "resources" nil .appValues }}
  {{- toYaml (default .root.Values.global.resources $res) | nindent 2 }}
{{- end }}

{{/*
Volume mounts: concatenates volumes + extraVolumes.
Usage: {{ include "radinage.volumeMounts" $ctx | nindent 10 }}
*/}}
{{- define "radinage.volumeMounts" -}}
{{- $volumeMounts := concat (default list .appValues.volumeMounts) (default list .appValues.extraVolumeMounts) }}
{{- with $volumeMounts }}
volumeMounts:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Volumes: concatenates volumes + extraVolumes.
Usage: {{ include "radinage.volumes" $ctx | nindent 6 }}
*/}}
{{- define "radinage.volumes" -}}
{{- $volumes := concat (default list .appValues.volumes) (default list .appValues.extraVolumes) }}
{{- with $volumes }}
volumes:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Scheduling: nodeSelector, affinity, tolerations.
Usage: {{ include "radinage.scheduling" $ctx | nindent 6 }}
*/}}
{{- define "radinage.scheduling" -}}
{{- with (default .root.Values.global.nodeSelector (dig "nodeSelector" nil .appValues)) }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with (default .root.Values.global.affinity (dig "affinity" nil .appValues)) }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with (default .root.Values.global.tolerations (dig "tolerations" nil .appValues)) }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

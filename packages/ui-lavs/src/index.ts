/**
 * LAVS Views plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"]. LAVS execution (manifests, script handlers) is
 * owned by `dsh-plugin-lavs-host`, composed independently on the host
 * roster.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}

import _ from 'lodash';
import { ComponentFactory } from '@teambit/component';
import { ComponentResult, ArtifactDefinition } from '@teambit/builder';
import { Capsule, IsolatorMain } from '@teambit/isolator';
import { ScopeMain } from '@teambit/scope';
import { BitError } from 'bit-bin/dist/error/bit-error';
import LegacyScope from 'bit-bin/dist/scope/scope';
import { Packer as LegacyPacker, PackWriteOptions, PackOptions } from 'bit-bin/dist/pack';
import { Logger } from '@teambit/logger';
import Bluebird from 'bluebird';

// @ts-ignore (for some reason the tsc -w not found this)
import { ScopeNotFound } from './exceptions/scope-not-found';

export { PackOptions };

export type PackResult = Omit<ComponentResult, 'component'>;
export type PackResultWithId = PackResult & {
  id: string;
};

const DEFAULT_TAR_DIR_IN_CAPSULE = 'package-tar';
export const TAR_FILE_ARTIFACT_NAME = 'package tar file';

export class Packer {
  legacyPacker: LegacyPacker;
  constructor(
    private isolator: IsolatorMain,
    private logger: Logger,
    private host: ComponentFactory,
    private scope?: ScopeMain
  ) {
    this.legacyPacker = new LegacyPacker(this.logger);
  }

  async packComponent(
    componentId: string,
    scopePath: string | undefined,
    options: PackOptions
  ): Promise<PackResultWithId> {
    // By default do not load scope from cache when packing
    const loadScopeFromCache =
      options && options.loadScopeFromCache !== undefined ? !!options.loadScopeFromCache : false;
    const legacyScope = scopePath ? await LegacyScope.load(scopePath, loadScopeFromCache) : this.scope?.legacyScope;
    if (!legacyScope) {
      throw new ScopeNotFound(scopePath);
    }
    // Or the scope we are operate on is legacy, or the host (workspace) is legacy
    const isLegacyScope = legacyScope.isLegacy || (!scopePath && this.host.isLegacy);

    // Handle legacy
    if (isLegacyScope) {
      const res = await this.legacyPacker.pack(componentId, legacyScope, options);
      // @ts-ignore
      return Object.assign({}, res, { id: componentId });
    }

    const capsule = await this.getCapsule(componentId, legacyScope);
    const res = await this.packCapsule(capsule, options.writeOptions, options.dryRun, options.writeOptions.override);
    return Object.assign({}, res, { id: componentId });
  }

  async packMultipleCapsules(
    capsules: Capsule[],
    writeOptions: PackWriteOptions,
    dryRun = false,
    override = true
  ): Promise<ComponentResult[]> {
    const description = `packing components${dryRun ? ' (dry-run)' : ''}`;
    const longProcessLogger = this.logger.createLongProcessLogger(description, capsules.length);
    const results = Bluebird.mapSeries(capsules, (capsule) => {
      longProcessLogger.logProgress(capsule.component.id.toString());
      return this.packCapsule(capsule, writeOptions, dryRun, override);
    });
    longProcessLogger.end();
    return results;
  }

  async packCapsule(
    capsule: Capsule,
    writeOptions: PackWriteOptions,
    dryRun = false,
    override = true
  ): Promise<ComponentResult> {
    const concreteWriteOpts = writeOptions;
    // Set the package-tar as out dir to easily read the tar later
    concreteWriteOpts.outDir = concreteWriteOpts.outDir ?? DEFAULT_TAR_DIR_IN_CAPSULE;
    const packResult = await this.legacyPacker.npmPack(
      capsule.path,
      concreteWriteOpts.outDir || capsule.path,
      override,
      dryRun
    );
    const component = capsule.component;
    const metadata = _(packResult.metadata).omitBy(_.isUndefined).omit(['tarPath']).value();

    return {
      component,
      metadata,
      errors: packResult.errors,
      startTime: packResult.startTime,
      endTime: packResult.endTime,
    };
  }

  getArtifactDefInCapsule(outDir?: string): ArtifactDefinition {
    const rootDir = outDir || DEFAULT_TAR_DIR_IN_CAPSULE;
    const def: ArtifactDefinition = {
      name: TAR_FILE_ARTIFACT_NAME,
      globPatterns: [`${rootDir}/*.tgz`],
    };
    return def;
  }

  private async getCapsule(componentIdStr: string, legacyScope: LegacyScope): Promise<Capsule> {
    const componentId = await this.host.resolveComponentId(componentIdStr);
    const component = await this.host.get(componentId);
    if (!component) {
      throw new BitError(`unable to find "${componentId}"`);
    }
    const capsules = await this.isolator.isolateComponents([component], { baseDir: this.host.path }, legacyScope);
    const capsule = capsules.getCapsule(componentId);

    if (!capsule) throw new Error(`capsule not found for ${componentId}`);
    return capsule;
  }
}

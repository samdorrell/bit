import { Logger } from '@teambit/logger';
import React from 'react';
import { Text, Newline } from 'ink';
import { EnvService, ExecutionContext, EnvDefinition } from '@teambit/envs';
import { ComponentMap } from '@teambit/component';
import { Workspace } from '@teambit/workspace';
import chalk from 'chalk';
import syntaxHighlighter from 'consolehighlighter';
import { PubSub } from 'graphql-subscriptions';

import { NoTestFilesFound } from './exceptions';
import { Tester, Tests, CallbackFn } from './tester';
import { TesterOptions } from './tester.main.runtime';
import { detectTestFiles } from './utils';

export const OnTestsChanged = 'OnTestsChanged';

export type TesterDescriptor = {
  /**
   * id of the tester (e.g. jest/mocha)
   */
  id: string;

  /**
   * display name of the tester (e.g. Jest / Mocha)
   */
  displayName: string;

  /**
   * icon of the configured tester.
   */
  icon: string;

  /**
   * string containing the config for display.
   */
  config: string;
};

export class TesterService implements EnvService<Tests, TesterDescriptor> {
  constructor(
    readonly workspace: Workspace,
    /**
     * regex used to identify which files to test.
     */
    readonly testsRegex: string,

    private logger: Logger,

    private pubsub: PubSub
  ) {}

  _callback: CallbackFn | undefined;

  render(env: EnvDefinition) {
    const descriptor = this.getDescriptor(env);
    return (
      <Text key={descriptor?.id}>
        <Text color="cyan">configured tester: </Text>
        <Text>
          {descriptor?.id} ({descriptor?.displayName})
        </Text>
        <Newline />
        <Text underline color="cyan">
          tester config:
        </Text>
        <Newline />
        <Text>
          {/* refactor a separate component which highlights for cli */}
          {syntaxHighlighter.highlight(descriptor?.config, 'javascript')}
        </Text>
        <Newline />
      </Text>
    );
  }

  getDescriptor(environment: EnvDefinition) {
    if (!environment.env.getTester) return undefined;
    const tester: Tester = environment.env.getTester();

    return {
      id: tester.id || '',
      displayName: tester.displayName || '',
      icon: tester.icon || '',
      config: tester.displayConfig ? tester.displayConfig() : '',
    };
  }

  onTestRunComplete(callback: CallbackFn) {
    this._callback = callback;
  }

  async run(context: ExecutionContext, options: TesterOptions): Promise<Tests> {
    const tester: Tester = context.env.getTester();
    const specFiles = ComponentMap.as(context.components, detectTestFiles);
    const testCount = specFiles.toArray().reduce((acc, [, specs]) => acc + specs.length, 0);
    const componentWithTests = specFiles.toArray().reduce((acc: number, [, specs]) => {
      if (specs.length > 0) acc += 1;
      return acc;
    }, 0);
    if (testCount === 0) throw new NoTestFilesFound(this.testsRegex);

    this.logger.console(`testing ${componentWithTests} components with environment ${chalk.cyan(context.id)}\n`);

    const testerContext = Object.assign(context, {
      release: false,
      specFiles,
      rootPath: this.workspace.path,
      workspace: this.workspace,
      debug: options.debug,
    });

    if (options.watch) {
      if (tester.onTestRunComplete) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        tester.onTestRunComplete((results) => {
          if (this._callback) this._callback(results);
          results.components.forEach((component) => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.pubsub.publish(OnTestsChanged, {
              testsChanged: { id: component.componentId.toString(), testsResults: component.results },
            });
          });
        });
      }
      return tester.watch(testerContext);
    }

    return tester.test(testerContext);
  }
}
import { Command, CommandOptions } from '@teambit/cli';
import { BASE_DOCS_DOMAIN } from 'bit-bin/dist/constants';
import chalk from 'chalk';
import { DependencyResolverMain } from './dependency-resolver.main.runtime';

export class CapsuleListCmd implements Command {
  name = 'link [ids...]';
  alias = '';
  description = `generate symlinks to resolve module paths for imported components.\n  https://${BASE_DOCS_DOMAIN}/docs/dependencies#missing-links`;
  shortDescription = 'link components and core aspects';
  group = 'capsules';
  private = false;
  options = [
    ['j', 'json', 'return the output as JSON'],
    ['r', 'rewire', 'EXPERIMENTAL. Replace relative paths with module paths in code (e.g. "../foo" => "@bit/foo")'],
  ] as CommandOptions;

  constructor(private dependencyResolver: DependencyResolverMain) {}

  async report() {}

  async json() {}
}
